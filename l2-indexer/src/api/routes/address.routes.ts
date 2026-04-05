import { Router, Request, Response } from 'express';
import { getTransactionsByAddress, getAddressTransactionCount } from '../../database/queries/transactions';
import { getLogsByTransactionHashes } from '../../database/queries/logs';
import {
  getBridgeHistoryByAddress,
  getBridgeHistoryCountByAddress,
  getBridgeLinksByTransactionHashes,
} from '../../database/queries/bridge';
import {
  APIResponse,
  AddressTransaction,
  BridgeRecord,
  BridgeRecordWithChallenge,
  BridgeTransactionLink,
  Transaction,
  TransactionCategory,
} from '../../types';
import cacheService from '../../services/cache.service';
import rpcService from '../../services/rpc.service';
import logger from '../../utils/logger';
import { buildLogsByTxHash, enrichBridgeLink, enrichBridgeRecord } from '../utils/bridge';

const router = Router();

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

const ERC20_TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function padAddressTopic(address: string): string {
  return `0x000000000000000000000000${address.toLowerCase().slice(2)}`;
}

function classifyCategory(tx: Transaction, hasErc20Transfer: boolean): TransactionCategory {
  if (hasErc20Transfer) return 'token_transfer';
  if (tx.toAddress && tx.value !== '0') return 'normal';
  if (!tx.toAddress) return 'contract_call';
  if (tx.value === '0') return 'contract_call';
  return 'other';
}

function attachBridgeContext(
  tx: AddressTransaction,
  bridgeLink: BridgeTransactionLink | undefined
): AddressTransaction {
  if (!bridgeLink) {
    return {
      ...tx,
      isBridgeTransaction: false,
      bridgeContext: null,
    };
  }

  return {
    ...tx,
    isBridgeTransaction: true,
    bridgeContext: enrichBridgeLink(bridgeLink, tx.tokenAddress),
  };
}

function parseOffset(value: string | undefined): number {
  const parsed = Number.parseInt(value || '0', 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * GET /api/v1/address/:address/transactions
 * Get transactions for an address
 */
router.get('/:address/transactions', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const limit = parseLimit(req.query.limit as string | undefined, 50, 200);
    const offset = parseOffset(req.query.offset as string | undefined);

    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Invalid address format',
      };
      return res.status(400).json(response);
    }

    // Check cache
    const cacheKey = `address:${address}:txs:${limit}:${offset}`;
    const cached = await cacheService.get<Transaction[]>(cacheKey);

    if (cached) {
      const response: APIResponse<Transaction[]> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    // Fetch from database
    const transactions = await getTransactionsByAddress(address.toLowerCase(), limit, offset);
    const total = await getAddressTransactionCount(address.toLowerCase());

    let enriched: AddressTransaction[] = transactions.map((tx) => ({
      ...tx,
      hasErc20Transfer: false,
      hasInternalTransfers: false,
      txCategory: classifyCategory(tx, false),
      isBridgeTransaction: false,
      bridgeContext: null,
    }));

    if (transactions.length > 0) {
      const hashes = transactions.map((tx) => tx.hash);
      const logs = await getLogsByTransactionHashes(hashes);
      const targetTopic = padAddressTopic(address);

      const logByTx = new Map<string, { token: string }>();
      for (const log of logs) {
        if (log.topic0 !== ERC20_TRANSFER_TOPIC0) continue;
        if (log.topic1 !== targetTopic && log.topic2 !== targetTopic) continue;
        if (!logByTx.has(log.transactionHash)) {
          logByTx.set(log.transactionHash, { token: log.address });
        }
      }

      const tokenAddresses = Array.from(new Set(Array.from(logByTx.values()).map((v) => v.token.toLowerCase())));
      const tokenMeta = new Map<string, { name: string | null; symbol: string | null; decimals: number | null }>();
      await Promise.all(tokenAddresses.map(async (token) => {
        const meta = await rpcService.getTokenMetadata(token);
        tokenMeta.set(token, meta);
      }));

      enriched = transactions.map((tx) => {
        const entry = logByTx.get(tx.hash);
        if (!entry) return {
          ...tx,
          hasErc20Transfer: false,
          hasInternalTransfers: false,
          txCategory: classifyCategory(tx, false),
        } as AddressTransaction;
        const meta = tokenMeta.get(entry.token.toLowerCase()) || { name: null, symbol: null, decimals: null };
        return {
          ...tx,
          tokenAddress: entry.token.toLowerCase(),
          tokenName: meta.name,
          tokenSymbol: meta.symbol,
          tokenDecimals: meta.decimals,
          hasErc20Transfer: true,
          hasInternalTransfers: false,
          txCategory: classifyCategory(tx, true),
        } as AddressTransaction;
      });
    }

    const bridgeLinks = await getBridgeLinksByTransactionHashes(transactions.map((tx) => tx.hash));
    const bridgeAware = enriched.map((tx) => attachBridgeContext(tx, bridgeLinks.get(tx.hash.toLowerCase())));

    // Cache result
    await cacheService.set(cacheKey, bridgeAware, 30);

    const response: APIResponse<AddressTransaction[]> = {
      success: true,
      data: bridgeAware,
      meta: {
        limit,
        offset,
        total,
      },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching address transactions', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch transactions',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/address/:address/bridge-history
 * Get bridge history for an address across both directions
 */
router.get('/:address/bridge-history', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const limit = parseLimit(req.query.limit as string | undefined, 50, 200);
    const offset = parseOffset(req.query.offset as string | undefined);

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ success: false, error: 'Invalid address format' });
    }

    const lower = address.toLowerCase();
    const cacheKey = `address:${lower}:bridge:${limit}:${offset}`;
    const cached = await cacheService.get<BridgeRecordWithChallenge[]>(cacheKey);

    if (cached) {
      return res.json({
        success: true,
        data: cached,
        meta: { limit, offset, total: cached.length },
      });
    }

    const [history, total] = await Promise.all([
      getBridgeHistoryByAddress(lower, limit, offset),
      getBridgeHistoryCountByAddress(lower),
    ]);

    const l2Hashes = history
      .map((record) => record.l2TxHash?.toLowerCase())
      .filter((hash): hash is string => Boolean(hash));
    const logsByTxHash = buildLogsByTxHash(await getLogsByTransactionHashes(l2Hashes));
    const enrichedHistory = history.map((record) => enrichBridgeRecord(record, logsByTxHash));
    await cacheService.set(cacheKey, enrichedHistory, 10);

    const response: APIResponse<BridgeRecordWithChallenge[]> = {
      success: true,
      data: enrichedHistory,
      meta: { limit, offset, total },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching address bridge history', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch bridge history' });
  }
});

/**
 * GET /api/v1/address/:address/count
 * Get transaction count for an address
 */
router.get('/:address/count', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Invalid address format',
      };
      return res.status(400).json(response);
    }

    const count = await getAddressTransactionCount(address.toLowerCase());

    const response: APIResponse<{ count: number }> = {
      success: true,
      data: { count },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching address count', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch transaction count',
    };

    res.status(500).json(response);
  }
});

export default router;
