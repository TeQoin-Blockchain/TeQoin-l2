import { ethers } from 'ethers';
import config from '../config';
import logger from '../utils/logger';
import { pool, query } from '../database/connection';
import { upsertL1WithdrawalStatus } from '../database/queries/bridge';

interface MissingLifecycleRow {
  bridge_id: string;
}

const L1_BRIDGE_ABI = [
  'event WithdrawalQueued(bytes32 indexed withdrawalId,address indexed token,address indexed to,uint256 amount,uint256 timestamp)',
  'event WithdrawalFinalized(bytes32 indexed withdrawalId,address indexed to,uint256 amount)',
];

const iface = new ethers.Interface(L1_BRIDGE_ABI);
const maybeQueuedTopic = iface.getEvent('WithdrawalQueued')?.topicHash;
const maybeFinalizedTopic = iface.getEvent('WithdrawalFinalized')?.topicHash;

if (!maybeQueuedTopic || !maybeFinalizedTopic) {
  throw new Error('Unable to resolve L1 withdrawal lifecycle topics');
}

const queuedTopic: string = maybeQueuedTopic;
const finalizedTopic: string = maybeFinalizedTopic;
const LOG_CHUNK_SIZE = 100_000;

async function getWithdrawalsMissingLifecycleFields(): Promise<string[]> {
  const rows = await query<MissingLifecycleRow>(
    `SELECT bridge_id
     FROM bridge_withdrawals
     WHERE l1_queue_tx_hash IS NULL
        OR (status = 'finalized' AND l1_finalization_tx_hash IS NULL)
     ORDER BY COALESCE(l2_block_number, 0) ASC, updated_at ASC`
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
    throw new Error(`Block ${blockNumber} not found while backfilling L1 withdrawal lifecycle`);
  }

  const timestamp = BigInt(block.timestamp);
  cache.set(blockNumber, timestamp);
  return timestamp;
}

async function main(): Promise<void> {
  if (!config.bridge.enabled) {
    throw new Error('Bridge indexing is not enabled');
  }

  const provider = new ethers.JsonRpcProvider(config.l1.rpcUrl);
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, config.bridge.startL1Block);
  const timestampCache = new Map<number, bigint>();
  const bridgeIds = await getWithdrawalsMissingLifecycleFields();
  const bridgeIdSet = new Set(bridgeIds);

  logger.info('Starting L1 withdrawal lifecycle backfill', {
    missingCount: bridgeIds.length,
    l1Bridge: config.bridge.l1Address,
    fromBlock,
    latestBlock,
  });

  let queueUpdated = 0;
  let finalizationUpdated = 0;
  const touched = new Set<string>();
  const queueSeen = new Set<string>();
  const finalizedSeen = new Set<string>();

  for (let start = fromBlock; start <= latestBlock; start += LOG_CHUNK_SIZE) {
    const end = Math.min(latestBlock, start + LOG_CHUNK_SIZE - 1);
    const queueLogs = await provider.getLogs({
      address: config.bridge.l1Address,
      fromBlock: start,
      toBlock: end,
      topics: [queuedTopic],
    });

    for (const log of queueLogs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index))) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) continue;
      const bridgeId = String(parsed.args.withdrawalId).toLowerCase();
      if (!bridgeIdSet.has(bridgeId) || queueSeen.has(bridgeId)) continue;

      const timestamp = await getBlockTimestamp(provider, log.blockNumber, timestampCache);
      await upsertL1WithdrawalStatus({
          bridgeId,
          status: 'queued',
          tokenAddress: String(parsed.args.token).toLowerCase(),
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l1TxHash: log.transactionHash.toLowerCase(),
          l1BlockNumber: BigInt(log.blockNumber),
          l1Timestamp: timestamp,
      });
      queueSeen.add(bridgeId);
      touched.add(bridgeId);
      queueUpdated += 1;
    }

    const finalizedLogs = await provider.getLogs({
      address: config.bridge.l1Address,
      fromBlock: start,
      toBlock: end,
      topics: [finalizedTopic],
    });

    for (const log of finalizedLogs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index))) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) continue;
      const bridgeId = String(parsed.args.withdrawalId).toLowerCase();
      if (!bridgeIdSet.has(bridgeId) || finalizedSeen.has(bridgeId)) continue;

      const timestamp = await getBlockTimestamp(provider, log.blockNumber, timestampCache);
      await upsertL1WithdrawalStatus({
          bridgeId,
          status: 'finalized',
          toAddress: String(parsed.args.to).toLowerCase(),
          amount: parsed.args.amount.toString(),
          l1TxHash: log.transactionHash.toLowerCase(),
          l1BlockNumber: BigInt(log.blockNumber),
          l1Timestamp: timestamp,
      });
      finalizedSeen.add(bridgeId);
      touched.add(bridgeId);
      finalizationUpdated += 1;
    }
  }

  const unresolved = bridgeIds.filter((bridgeId) => !touched.has(bridgeId));
  for (const bridgeId of unresolved) {
    logger.warn('No L1 withdrawal lifecycle logs found for bridge id', { bridgeId });
  }

  logger.info('L1 withdrawal lifecycle backfill complete', {
    missingCount: bridgeIds.length,
    queueUpdated,
    finalizationUpdated,
    unresolvedCount: unresolved.length,
    unresolved,
  });
}

main()
  .catch((error) => {
    logger.error('L1 withdrawal lifecycle backfill failed', { error: error?.message || String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
