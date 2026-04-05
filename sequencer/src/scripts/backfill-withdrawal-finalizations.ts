import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { closeDatabase, initDatabase, query } from '../database/connection';
import { logger } from '../utils/logger';

dotenv.config();

interface MissingFinalizationRow {
  withdrawal_id: string;
}

const L1_BRIDGE_ABI = [
  'event WithdrawalFinalized(bytes32 indexed withdrawalId,address indexed to,uint256 amount)',
];

const iface = new ethers.Interface(L1_BRIDGE_ABI);
const maybeFinalizedTopic = iface.getEvent('WithdrawalFinalized')?.topicHash;

if (!maybeFinalizedTopic) {
  throw new Error('Unable to resolve WithdrawalFinalized topic');
}

const finalizedTopic: string = maybeFinalizedTopic;
const LOG_CHUNK_SIZE = 100_000;

async function getMissingFinalizations(): Promise<string[]> {
  const result = await query(
    `SELECT withdrawal_id
     FROM withdrawals
     WHERE finalized = TRUE
       AND finalization_tx_hash IS NULL
     ORDER BY finalized_at ASC NULLS LAST, queued_at ASC NULLS LAST`
  );

  return result.rows.map((row: MissingFinalizationRow) => row.withdrawal_id.toLowerCase());
}

async function main(): Promise<void> {
  const rpcUrl = process.env.L1_RPC_URL || '';
  const bridgeAddress = process.env.L1_DIAMOND_ADDRESS || '';
  const databaseUrl = process.env.DATABASE_URL || '';

  if (!rpcUrl || !bridgeAddress || !databaseUrl) {
    throw new Error('L1_RPC_URL, L1_DIAMOND_ADDRESS, and DATABASE_URL are required');
  }

  await initDatabase(databaseUrl);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const latestBlock = await provider.getBlockNumber();
  const missing = await getMissingFinalizations();
  const missingSet = new Set(missing);

  logger.info('Starting withdrawal finalization backfill', {
    missingCount: missing.length,
    bridgeAddress,
    latestBlock,
  });

  let updated = 0;
  const found = new Set<string>();

  for (let fromBlock = 0; fromBlock <= latestBlock && found.size < missingSet.size; fromBlock += LOG_CHUNK_SIZE) {
    const toBlock = Math.min(latestBlock, fromBlock + LOG_CHUNK_SIZE - 1);
    const logs = await provider.getLogs({
      address: bridgeAddress,
      fromBlock,
      toBlock,
      topics: [finalizedTopic],
    });

    for (const log of logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index))) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) continue;

      const withdrawalId = String(parsed.args.withdrawalId).toLowerCase();
      if (!missingSet.has(withdrawalId) || found.has(withdrawalId)) {
        continue;
      }

      await query(
        `UPDATE withdrawals
         SET finalization_tx_hash = $2
         WHERE withdrawal_id = $1`,
        [withdrawalId, log.transactionHash.toLowerCase()]
      );

      found.add(withdrawalId);
      updated += 1;
      logger.info('Backfilled withdrawal finalization tx hash', {
        withdrawalId,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
  }

  const unresolved = missing.filter((withdrawalId) => !found.has(withdrawalId));

  logger.info('Withdrawal finalization backfill complete', {
    missingCount: missing.length,
    updated,
    unresolvedCount: unresolved.length,
    unresolved,
  });
}

main()
  .catch((error) => {
    logger.error('Withdrawal finalization backfill failed', { error: error?.message || String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
