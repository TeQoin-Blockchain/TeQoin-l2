import { query } from './connection';
import { Deposit, Withdrawal, Batch, SequencerStats } from '../types';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════
// DEPOSIT MODELS
// ═══════════════════════════════════════════════════════

export async function saveDeposit(deposit: Deposit): Promise<void> {
  const text = `
    INSERT INTO deposits (deposit_id, token_address, recipient, amount, l1_block_number, l1_tx_hash)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (deposit_id) DO NOTHING
  `;
  
  const values = [
    deposit.depositId,
    deposit.tokenAddress,
    deposit.recipient,
    deposit.amount,
    deposit.l1BlockNumber.toString(),
    deposit.l1TxHash,
  ];
  
  await query(text, values);
  logger.debug('Deposit saved to database', { depositId: deposit.depositId });
}

export async function getPendingDeposits(limit: number = 10): Promise<Deposit[]> {
  const text = `
    SELECT * FROM deposits 
    WHERE processed = FALSE 
    ORDER BY l1_block_number ASC 
    LIMIT $1
  `;
  
  const result = await query(text, [limit]);
  return result.rows.map(rowToDeposit);
}

export async function markDepositProcessed(depositId: string, l2TxHash: string): Promise<void> {
  const text = `
    UPDATE deposits 
    SET processed = TRUE, l2_tx_hash = $1, processed_at = NOW() 
    WHERE deposit_id = $2
  `;
  
  await query(text, [l2TxHash, depositId]);
  logger.debug('Deposit marked as processed', { depositId, l2TxHash });
}

export async function getDepositById(depositId: string): Promise<Deposit | null> {
  const text = `SELECT * FROM deposits WHERE deposit_id = $1`;
  const result = await query(text, [depositId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToDeposit(result.rows[0]);
}

// ═══════════════════════════════════════════════════════
// WITHDRAWAL MODELS
// ═══════════════════════════════════════════════════════

export async function saveWithdrawal(withdrawal: Withdrawal): Promise<void> {
  const text = `
    INSERT INTO withdrawals (withdrawal_id, token_address, sender, recipient, amount, l2_block_number, l2_tx_hash)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (withdrawal_id) DO NOTHING
  `;
  
  const values = [
    withdrawal.withdrawalId,
    withdrawal.tokenAddress,
    withdrawal.sender,
    withdrawal.recipient,
    withdrawal.amount,
    withdrawal.l2BlockNumber.toString(),
    withdrawal.l2TxHash,
  ];
  
  await query(text, values);
  logger.debug('Withdrawal saved to database', { withdrawalId: withdrawal.withdrawalId });
}

export async function getPendingWithdrawals(limit: number = 100): Promise<Withdrawal[]> {
  const text = `
    SELECT * FROM withdrawals 
    WHERE queued = FALSE 
    ORDER BY l2_block_number ASC 
    LIMIT $1
  `;
  
  const result = await query(text, [limit]);
  return result.rows.map(rowToWithdrawal);
}


export async function getWithdrawalsInRange(
  startBlock: bigint,
  endBlock: bigint
): Promise<Withdrawal[]> {
  const text = `
    SELECT * FROM withdrawals
    WHERE l2_block_number >= $1 
      AND l2_block_number <= $2
      AND queued = false
    ORDER BY l2_block_number ASC
  `;
  
  const result = await query(text, [startBlock.toString(), endBlock.toString()]);
  return result.rows.map(rowToWithdrawal);
}

export async function markWithdrawalQueued(withdrawalId: string, l1TxHash: string): Promise<void> {
  const text = l1TxHash? `
    UPDATE withdrawals 
    SET queued = TRUE, queued_at = NOW(), l1_tx_hash = $2
    WHERE withdrawal_id = $1
  `
  : `
      UPDATE withdrawals 
      SET queued = TRUE, queued_at = NOW()
      WHERE withdrawal_id = $1
    `;

  
  const values = l1TxHash ? [withdrawalId, l1TxHash] : [withdrawalId];
  
  await query(text, values);
  logger.debug('Withdrawal marked as queued', { withdrawalId, l1TxHash });
}

// ═══════════════════════════════════════════════════════
// BATCH MODELS
// ═══════════════════════════════════════════════════════

export async function saveBatch(batch: Batch): Promise<void> {
  const text = `
    INSERT INTO batches (batch_number, l2_start_block, l2_end_block, state_root, transactions_root)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (batch_number) DO NOTHING
  `;
  
  const values = [
    batch.batchNumber.toString(),
    batch.l2StartBlock.toString(),
    batch.l2EndBlock.toString(),
    batch.stateRoot,
    batch.transactionsRoot,
  ];
  
  await query(text, values);
  logger.debug('Batch saved to database', { batchNumber: batch.batchNumber.toString() });
}

export async function markBatchSubmitted(batchNumber: bigint, l1TxHash: string): Promise<void> {
  const text = `
    UPDATE batches 
    SET submitted = TRUE, l1_tx_hash = $1, submitted_at = NOW() 
    WHERE batch_number = $2
  `;
  
  await query(text, [l1TxHash, batchNumber.toString()]);
  logger.debug('Batch marked as submitted', { batchNumber: batchNumber.toString(), l1TxHash });
}

export async function getLastBatchNumber(): Promise<bigint> {
  const text = `SELECT MAX(batch_number) as max_batch FROM batches`;
  const result = await query(text);
  
  if (result.rows[0].max_batch === null) {
    return 0n;
  }
  
  return BigInt(result.rows[0].max_batch);
}

export async function getLastSubmittedBlock(): Promise<bigint> {
  const text = `
    SELECT l2_end_block FROM batches 
    WHERE submitted = TRUE 
    ORDER BY batch_number DESC 
    LIMIT 1
  `;
  
  const result = await query(text);
  
  if (result.rows.length === 0) {
    return 0n;
  }
  
  return BigInt(result.rows[0].l2_end_block);
}

// ═══════════════════════════════════════════════════════
// SEQUENCER STATE
// ═══════════════════════════════════════════════════════

export async function getState(key: string): Promise<string | null> {
  const text = `SELECT value FROM sequencer_state WHERE key = $1`;
  const result = await query(text, [key]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0].value;
}

export async function setState(key: string, value: string): Promise<void> {
  const text = `
    INSERT INTO sequencer_state (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) 
    DO UPDATE SET value = $2, updated_at = NOW()
  `;
  
  await query(text, [key, value]);
}

// ═══════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════

export async function getStats(): Promise<SequencerStats> {
  const depositsResult = await query('SELECT COUNT(*) as count FROM deposits WHERE processed = TRUE');
  const withdrawalsResult = await query('SELECT COUNT(*) as count FROM withdrawals WHERE queued = TRUE');
  const batchesResult = await query('SELECT COUNT(*) as count FROM batches WHERE submitted = TRUE');
  const lastBatchBlock = await getLastSubmittedBlock();
  
  return {
    depositsProcessed: parseInt(depositsResult.rows[0].count),
    withdrawalsQueued: parseInt(withdrawalsResult.rows[0].count),
    batchesSubmitted: parseInt(batchesResult.rows[0].count),
    lastBatchBlock,
  };
}

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

function rowToDeposit(row: any): Deposit {
  return {
    id: row.id,
    depositId: row.deposit_id,
    tokenAddress: row.token_address,
    recipient: row.recipient,
    amount: row.amount,
    l1BlockNumber: BigInt(row.l1_block_number),
    l1TxHash: row.l1_tx_hash,
    processed: row.processed,
    l2TxHash: row.l2_tx_hash,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

function rowToWithdrawal(row: any): Withdrawal {
  return {
    id: row.id,
    withdrawalId: row.withdrawal_id,
    tokenAddress: row.token_address,
    sender: row.sender,
    recipient: row.recipient,
    amount: row.amount,
    l2BlockNumber: BigInt(row.l2_block_number),
    l2TxHash: row.l2_tx_hash,
    queued: row.queued,
    finalized: row.finalized,
    l1TxHash: row.l1_tx_hash,
    createdAt: row.created_at,
    queuedAt: row.queued_at,
    finalizedAt: row.finalized_at,
  };
}

export default {
  saveDeposit,
  getPendingDeposits,
  markDepositProcessed,
  getDepositById,
  saveWithdrawal,
  getPendingWithdrawals,
  getWithdrawalsInRange,
  markWithdrawalQueued,
  saveBatch,
  markBatchSubmitted,
  getLastBatchNumber,
  getLastSubmittedBlock,
  getState,
  setState,
  getStats,
};