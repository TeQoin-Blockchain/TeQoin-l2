import { ethers } from 'ethers';
import config from '../config';
import logger from '../utils/logger';
import { pool, query } from '../database/connection';
import { upsertL2WithdrawalInitiated } from '../database/queries/bridge';

interface MissingWithdrawalRow {
  bridge_id: string;
}

const L2_BRIDGE_ABI = [
  'event WithdrawalInitiated(bytes32 indexed withdrawalId,address indexed token,address indexed from,address to,uint256 amount,uint256 nonce)',
];

const iface = new ethers.Interface(L2_BRIDGE_ABI);
const withdrawalEvent = iface.getEvent('WithdrawalInitiated');

if (!withdrawalEvent) {
  throw new Error('Unable to resolve WithdrawalInitiated topic');
}
const eventTopic = withdrawalEvent.topicHash;

async function getMissingWithdrawals(): Promise<string[]> {
  const rows = await query<MissingWithdrawalRow>(
    `SELECT bridge_id
     FROM bridge_withdrawals
     WHERE l2_timestamp IS NULL
     ORDER BY COALESCE(l1_block_number, 0) ASC, updated_at ASC`
  );

  return rows.map((row) => row.bridge_id.toLowerCase());
}

async function getBlockTimestamp(
  provider: ethers.JsonRpcProvider,
  blockNumber: number,
  cache: Map<number, bigint>
): Promise<bigint> {
  const cached = cache.get(blockNumber);
  if (cached !== undefined) {
    return cached;
  }

  const block = await provider.getBlock(blockNumber);
  if (!block) {
    throw new Error(`Block ${blockNumber} not found while backfilling withdrawals`);
  }

  const timestamp = BigInt(block.timestamp);
  cache.set(blockNumber, timestamp);
  return timestamp;
}

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(config.l2.rpcUrl);
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, config.bridge.startL2Block);
  const timestampCache = new Map<number, bigint>();

  const missingIds = await getMissingWithdrawals();
  logger.info('Starting withdrawal backfill', {
    missingCount: missingIds.length,
    l2Bridges: config.bridge.l2Addresses,
    fromBlock,
    latestBlock,
  });

  let updated = 0;
  const unresolved: string[] = [];

  for (const bridgeId of missingIds) {
    const logs = await provider.getLogs({
      address: config.bridge.l2Addresses,
      fromBlock,
      toBlock: latestBlock,
      topics: [eventTopic, bridgeId],
    });

    if (logs.length === 0) {
      unresolved.push(bridgeId);
      logger.warn('No L2 WithdrawalInitiated log found for bridge id', { bridgeId });
      continue;
    }

    const log = logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index))[0];
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) {
      unresolved.push(bridgeId);
      logger.warn('Unable to parse WithdrawalInitiated log for bridge id', { bridgeId, txHash: log.transactionHash });
      continue;
    }
    const timestamp = await getBlockTimestamp(provider, log.blockNumber, timestampCache);

    await upsertL2WithdrawalInitiated({
      bridgeId,
      tokenAddress: String(parsed.args.token).toLowerCase(),
      fromAddress: String(parsed.args.from).toLowerCase(),
      toAddress: String(parsed.args.to).toLowerCase(),
      amount: parsed.args.amount.toString(),
      l2TxHash: log.transactionHash.toLowerCase(),
      l2BlockNumber: BigInt(log.blockNumber),
      l2Timestamp: timestamp,
    });

    updated += 1;
    logger.info('Backfilled withdrawal initiation', {
      bridgeId,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: timestamp.toString(),
    });
  }

  logger.info('Withdrawal backfill complete', {
    missingCount: missingIds.length,
    updated,
    unresolvedCount: unresolved.length,
    unresolved,
  });
}

main()
  .catch((error) => {
    logger.error('Withdrawal backfill failed', { error: error?.message || String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
