"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveDeposit = saveDeposit;
exports.getPendingDeposits = getPendingDeposits;
exports.markDepositProcessed = markDepositProcessed;
exports.getDepositById = getDepositById;
exports.saveWithdrawal = saveWithdrawal;
exports.getPendingWithdrawals = getPendingWithdrawals;
exports.markWithdrawalQueued = markWithdrawalQueued;
exports.saveBatch = saveBatch;
exports.markBatchSubmitted = markBatchSubmitted;
exports.getLastBatchNumber = getLastBatchNumber;
exports.getLastSubmittedBlock = getLastSubmittedBlock;
exports.getState = getState;
exports.setState = setState;
exports.getStats = getStats;
const connection_1 = require("./connection");
const logger_1 = require("../utils/logger");
// ═══════════════════════════════════════════════════════
// DEPOSIT MODELS
// ═══════════════════════════════════════════════════════
async function saveDeposit(deposit) {
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
    await (0, connection_1.query)(text, values);
    logger_1.logger.debug('Deposit saved to database', { depositId: deposit.depositId });
}
async function getPendingDeposits(limit = 10) {
    const text = `
    SELECT * FROM deposits 
    WHERE processed = FALSE 
    ORDER BY l1_block_number ASC 
    LIMIT $1
  `;
    const result = await (0, connection_1.query)(text, [limit]);
    return result.rows.map(rowToDeposit);
}
async function markDepositProcessed(depositId, l2TxHash) {
    const text = `
    UPDATE deposits 
    SET processed = TRUE, l2_tx_hash = $1, processed_at = NOW() 
    WHERE deposit_id = $2
  `;
    await (0, connection_1.query)(text, [l2TxHash, depositId]);
    logger_1.logger.debug('Deposit marked as processed', { depositId, l2TxHash });
}
async function getDepositById(depositId) {
    const text = `SELECT * FROM deposits WHERE deposit_id = $1`;
    const result = await (0, connection_1.query)(text, [depositId]);
    if (result.rows.length === 0) {
        return null;
    }
    return rowToDeposit(result.rows[0]);
}
// ═══════════════════════════════════════════════════════
// WITHDRAWAL MODELS
// ═══════════════════════════════════════════════════════
async function saveWithdrawal(withdrawal) {
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
    await (0, connection_1.query)(text, values);
    logger_1.logger.debug('Withdrawal saved to database', { withdrawalId: withdrawal.withdrawalId });
}
async function getPendingWithdrawals(limit = 100) {
    const text = `
    SELECT * FROM withdrawals 
    WHERE queued = FALSE 
    ORDER BY l2_block_number ASC 
    LIMIT $1
  `;
    const result = await (0, connection_1.query)(text, [limit]);
    return result.rows.map(rowToWithdrawal);
}
async function markWithdrawalQueued(withdrawalId) {
    const text = `
    UPDATE withdrawals 
    SET queued = TRUE, queued_at = NOW() 
    WHERE withdrawal_id = $1
  `;
    await (0, connection_1.query)(text, [withdrawalId]);
    logger_1.logger.debug('Withdrawal marked as queued', { withdrawalId });
}
// ═══════════════════════════════════════════════════════
// BATCH MODELS
// ═══════════════════════════════════════════════════════
async function saveBatch(batch) {
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
    await (0, connection_1.query)(text, values);
    logger_1.logger.debug('Batch saved to database', { batchNumber: batch.batchNumber.toString() });
}
async function markBatchSubmitted(batchNumber, l1TxHash) {
    const text = `
    UPDATE batches 
    SET submitted = TRUE, l1_tx_hash = $1, submitted_at = NOW() 
    WHERE batch_number = $2
  `;
    await (0, connection_1.query)(text, [l1TxHash, batchNumber.toString()]);
    logger_1.logger.debug('Batch marked as submitted', { batchNumber: batchNumber.toString(), l1TxHash });
}
async function getLastBatchNumber() {
    const text = `SELECT MAX(batch_number) as max_batch FROM batches`;
    const result = await (0, connection_1.query)(text);
    if (result.rows[0].max_batch === null) {
        return 0n;
    }
    return BigInt(result.rows[0].max_batch);
}
async function getLastSubmittedBlock() {
    const text = `
    SELECT l2_end_block FROM batches 
    WHERE submitted = TRUE 
    ORDER BY batch_number DESC 
    LIMIT 1
  `;
    const result = await (0, connection_1.query)(text);
    if (result.rows.length === 0) {
        return 0n;
    }
    return BigInt(result.rows[0].l2_end_block);
}
// ═══════════════════════════════════════════════════════
// SEQUENCER STATE
// ═══════════════════════════════════════════════════════
async function getState(key) {
    const text = `SELECT value FROM sequencer_state WHERE key = $1`;
    const result = await (0, connection_1.query)(text, [key]);
    if (result.rows.length === 0) {
        return null;
    }
    return result.rows[0].value;
}
async function setState(key, value) {
    const text = `
    INSERT INTO sequencer_state (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) 
    DO UPDATE SET value = $2, updated_at = NOW()
  `;
    await (0, connection_1.query)(text, [key, value]);
}
// ═══════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════
async function getStats() {
    const depositsResult = await (0, connection_1.query)('SELECT COUNT(*) as count FROM deposits WHERE processed = TRUE');
    const withdrawalsResult = await (0, connection_1.query)('SELECT COUNT(*) as count FROM withdrawals WHERE queued = TRUE');
    const batchesResult = await (0, connection_1.query)('SELECT COUNT(*) as count FROM batches WHERE submitted = TRUE');
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
function rowToDeposit(row) {
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
function rowToWithdrawal(row) {
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
exports.default = {
    saveDeposit,
    getPendingDeposits,
    markDepositProcessed,
    getDepositById,
    saveWithdrawal,
    getPendingWithdrawals,
    markWithdrawalQueued,
    saveBatch,
    markBatchSubmitted,
    getLastBatchNumber,
    getLastSubmittedBlock,
    getState,
    setState,
    getStats,
};
//# sourceMappingURL=models.js.map