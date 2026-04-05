import { Router, Request, Response } from 'express';
import { getLatestTransactions, getTransaction } from '../../database/queries/transactions';
import { getLogsByTransaction, getLogsByTransactionHashes } from '../../database/queries/logs';
import { getBridgeLinksByTransactionHashes } from '../../database/queries/bridge';
import {
  APIResponse,
  BridgeTransactionLink,
  EnrichedTransaction,
  Log,
  Transaction,
  TransactionClassification,
  TransactionCategory,
} from '../../types';
import cacheService from '../../services/cache.service';
import rpcService from '../../services/rpc.service';
import logger from '../../utils/logger';
import { enrichBridgeLink } from '../utils/bridge';

const router = Router();

const ERC20_TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function padAddressTopic(address: string): string {
  return `0x000000000000000000000000${address.toLowerCase().slice(2)}`;
}

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || `${fallback}`, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function classifyTransaction(tx: Transaction, isContractCall: boolean): TransactionClassification {
  if (!tx.toAddress) return 'contract_creation';
  return isContractCall ? 'contract_call' : 'eoa_transfer';
}

function classifyCategory(tx: Transaction, hasErc20Transfer: boolean): TransactionCategory {
  if (hasErc20Transfer) return 'token_transfer';
  if (tx.toAddress && tx.value !== '0') return 'normal';
  if (!tx.toAddress) return 'contract_call';
  if (tx.value === '0') return 'contract_call';
  return 'other';
}

function attachBridgeContext(
  tx: EnrichedTransaction,
  bridgeLink: BridgeTransactionLink | undefined
): EnrichedTransaction {
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

async function attachTokenMetadata(
  tx: EnrichedTransaction,
  logs: Log[]
): Promise<EnrichedTransaction> {
  const targetTopicFrom = padAddressTopic(tx.fromAddress);
  const targetTopicTo = tx.toAddress ? padAddressTopic(tx.toAddress) : null;
  const zeroTopic = padAddressTopic('0x0000000000000000000000000000000000000000');

  const transferLog = logs.find((log) => {
    if (log.topic0 !== ERC20_TRANSFER_TOPIC0) return false;
    if (log.transactionHash.toLowerCase() != tx.hash.toLowerCase()) return false;
    if (log.topic1 === targetTopicFrom || log.topic2 === targetTopicFrom) return true;
    if (targetTopicTo && (log.topic1 === targetTopicTo || log.topic2 === targetTopicTo)) return true;
    if (log.topic1 === zeroTopic || log.topic2 === zeroTopic) return true;
    return false;
  });

  if (!transferLog) {
    return {
      ...tx,
      hasErc20Transfer: false,
      hasInternalTransfers: false,
      txCategory: classifyCategory(tx, false),
    };
  }

  const meta = await rpcService.getTokenMetadata(transferLog.address);
  return {
    ...tx,
    tokenAddress: transferLog.address.toLowerCase(),
    tokenName: meta.name,
    tokenSymbol: meta.symbol,
    tokenDecimals: meta.decimals,
    hasErc20Transfer: true,
    hasInternalTransfers: false,
    txCategory: classifyCategory(tx, true),
  };
}

async function attachTokenMetadataBatch(
  txs: EnrichedTransaction[]
): Promise<EnrichedTransaction[]> {
  if (txs.length === 0) return txs;

  const hashes = txs.map((t) => t.hash);
  const logs = await getLogsByTransactionHashes(hashes);

  const logsByTx = new Map<string, Log[]>();
  for (const log of logs) {
    const key = log.transactionHash.toLowerCase();
    const arr = logsByTx.get(key) || [];
    arr.push(log);
    logsByTx.set(key, arr);
  }

  const tokenAddresses = new Set<string>();
  for (const log of logs) {
    if (log.topic0 == ERC20_TRANSFER_TOPIC0) tokenAddresses.add(log.address.toLowerCase());
  }
  const tokenMeta = new Map<string, { name: string | null; symbol: string | null; decimals: number | null }>();
  await Promise.all(Array.from(tokenAddresses).map(async (addr) => {
    const meta = await rpcService.getTokenMetadata(addr);
    tokenMeta.set(addr, meta);
  }));

  return txs.map((tx) => {
    const logsForTx = logsByTx.get(tx.hash.toLowerCase()) || [];
    const targetFrom = padAddressTopic(tx.fromAddress);
    const targetTo = tx.toAddress ? padAddressTopic(tx.toAddress) : null;
    const zeroTopic = padAddressTopic('0x0000000000000000000000000000000000000000');

    const transferLog = logsForTx.find((log) => {
      if (log.topic0 !== ERC20_TRANSFER_TOPIC0) return false;
      if (log.topic1 === targetFrom || log.topic2 === targetFrom) return true;
      if (targetTo && (log.topic1 === targetTo || log.topic2 === targetTo)) return true;
      if (log.topic1 === zeroTopic || log.topic2 === zeroTopic) return true;
      return false;
    });

    if (!transferLog) {
      return {
        ...tx,
        hasErc20Transfer: false,
        hasInternalTransfers: false,
        txCategory: classifyCategory(tx, false),
      };
    }
    const meta = tokenMeta.get(transferLog.address.toLowerCase()) || { name: null, symbol: null, decimals: null };
    return {
      ...tx,
      tokenAddress: transferLog.address.toLowerCase(),
      tokenName: meta.name,
      tokenSymbol: meta.symbol,
      tokenDecimals: meta.decimals,
      hasErc20Transfer: true,
      hasInternalTransfers: false,
      txCategory: classifyCategory(tx, true),
    };
  });
}

function withFeeAndClassification(tx: Transaction, isContractCall: boolean): EnrichedTransaction {
  const gasPriceBid = tx.maxFeePerGas || tx.gasPrice;
  const gasPricePaid = tx.effectiveGasPrice || tx.gasPrice;

  return {
    ...tx,
    fee: (gasPricePaid * tx.gasUsed).toString(),
    gasPriceBid: gasPriceBid.toString(),
    gasPricePaid: gasPricePaid.toString(),
    gasFeeBase: tx.baseFeePerGas !== null ? tx.baseFeePerGas.toString() : null,
    gasFeeMax: tx.maxFeePerGas !== null ? tx.maxFeePerGas.toString() : null,
    gasFeeMaxPriority: tx.maxPriorityFeePerGas !== null ? tx.maxPriorityFeePerGas.toString() : null,
    isContractCall,
    classification: classifyTransaction(tx, isContractCall),
    hasErc20Transfer: false,
    hasInternalTransfers: false,
    txCategory: classifyCategory(tx, false),
    isBridgeTransaction: false,
    bridgeContext: null,
  };
}

async function enrichTransaction(tx: Transaction): Promise<EnrichedTransaction> {
  if (!tx.toAddress) {
    return withFeeAndClassification(tx, false);
  }

  const isContractCall = await rpcService.isContractAddress(tx.toAddress);
  return withFeeAndClassification(tx, isContractCall);
}

async function enrichTransactions(transactions: Transaction[]): Promise<EnrichedTransaction[]> {
  const uniqueTargets = Array.from(
    new Set(transactions.map((tx) => tx.toAddress?.toLowerCase()).filter(Boolean))
  ) as string[];

  const contractMap = new Map<string, boolean>();
  await Promise.all(
    uniqueTargets.map(async (address) => {
      const isContract = await rpcService.isContractAddress(address);
      contractMap.set(address, isContract);
    })
  );

  return transactions.map((tx) => {
    if (!tx.toAddress) return withFeeAndClassification(tx, false);
    const isContractCall = contractMap.get(tx.toAddress.toLowerCase()) || false;
    return withFeeAndClassification(tx, isContractCall);
  });
}

async function attachBridgeContextBatch(
  txs: EnrichedTransaction[]
): Promise<EnrichedTransaction[]> {
  if (txs.length === 0) return txs;

  const bridgeLinks = await getBridgeLinksByTransactionHashes(txs.map((tx) => tx.hash));
  return txs.map((tx) => attachBridgeContext(tx, bridgeLinks.get(tx.hash.toLowerCase())));
}

/**
 * GET /api/v1/transaction/latest?limit=20
 * Latest transaction feed (global)
 */
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit as string | undefined, 20, 100);

    // Check cache
    const cacheKey = `tx:latest:${limit}`;
    const cached = await cacheService.get<EnrichedTransaction[]>(cacheKey);

    if (cached) {
      const response: APIResponse<EnrichedTransaction[]> = {
        success: true,
        data: cached,
        meta: { limit, total: cached.length },
      };
      return res.json(response);
    }

    const transactions = await getLatestTransactions(limit);
    const enriched = await enrichTransactions(transactions);
    const withToken = await attachTokenMetadataBatch(enriched);
    const withBridge = await attachBridgeContextBatch(withToken);

    await cacheService.set(cacheKey, withBridge, 10);

    const response: APIResponse<EnrichedTransaction[]> = {
      success: true,
      data: withBridge,
      meta: { limit, total: withBridge.length },
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching latest transactions', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch latest transactions',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/transaction/:hash
 * Get transaction by hash
 */
router.get('/:hash', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;

    // Validate hash
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Invalid transaction hash format',
      };
      return res.status(400).json(response);
    }

    // Check cache
    const cacheKey = `tx:${hash}`;
    const cached = await cacheService.get<EnrichedTransaction>(cacheKey);

    if (cached) {
      const response: APIResponse<EnrichedTransaction> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    // Fetch from database
    const transaction = await getTransaction(hash);

    if (!transaction) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Transaction not found',
      };
      return res.status(404).json(response);
    }

    const enriched = await enrichTransaction(transaction);
    const logs = await getLogsByTransaction(hash);
    const withToken = await attachTokenMetadata(enriched, logs);
    const bridgeLinks = await getBridgeLinksByTransactionHashes([hash.toLowerCase()]);
    const withBridge = attachBridgeContext(withToken, bridgeLinks.get(hash.toLowerCase()));

    // Cache result
    await cacheService.set(cacheKey, withBridge, 300);

    const response: APIResponse<EnrichedTransaction> = {
      success: true,
      data: withBridge,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching transaction', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch transaction',
    };

    res.status(500).json(response);
  }
});

/**
 * GET /api/v1/transaction/:hash/logs
 * Get logs for a transaction
 */
router.get('/:hash/logs', async (req: Request, res: Response) => {
  try {
    const { hash } = req.params;

    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      const response: APIResponse<null> = {
        success: false,
        error: 'Invalid transaction hash format',
      };
      return res.status(400).json(response);
    }

    // Check cache
    const cacheKey = `tx:${hash}:logs`;
    const cached = await cacheService.get<Log[]>(cacheKey);

    if (cached) {
      const response: APIResponse<Log[]> = {
        success: true,
        data: cached,
      };
      return res.json(response);
    }

    // Fetch from database
    const logs = await getLogsByTransaction(hash);

    // Cache result
    await cacheService.set(cacheKey, logs, 300);

    const response: APIResponse<Log[]> = {
      success: true,
      data: logs,
    };

    res.json(response);
  } catch (error: any) {
    logger.error('Error fetching transaction logs', { error: error.message });

    const response: APIResponse<null> = {
      success: false,
      error: 'Failed to fetch logs',
    };

    res.status(500).json(response);
  }
});

export default router;
