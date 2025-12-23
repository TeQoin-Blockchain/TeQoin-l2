"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const pg_1 = require("pg");
const logger_1 = require("../utils/logger");
class DatabaseService {
    pool;
    constructor(config) {
        this.pool = new pg_1.Pool(config);
        logger_1.logger.info('Database service initialized');
    }
    async connect() {
        try {
            const client = await this.pool.connect();
            logger_1.logger.info('✅ Database connected successfully');
            client.release();
        }
        catch (error) {
            logger_1.logger.error('❌ Database connection failed:', error);
            throw error;
        }
    }
    async saveBlock(block) {
        const query = `
      INSERT INTO blocks (number, hash, parent_hash, state_root, timestamp, transaction_count, gas_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (number) DO NOTHING
    `;
        try {
            await this.pool.query(query, [
                block.number.toString(),
                block.hash,
                block.parentHash,
                block.stateRoot,
                block.timestamp.toString(),
                block.transactionCount,
                block.gasUsed.toString(),
            ]);
        }
        catch (error) {
            logger_1.logger.error('Failed to save block:', error);
            throw error;
        }
    }
    async getLastBlock() {
        const query = 'SELECT * FROM blocks ORDER BY number DESC LIMIT 1';
        try {
            const result = await this.pool.query(query);
            if (result.rows.length === 0)
                return null;
            const row = result.rows[0];
            return {
                number: BigInt(row.number),
                hash: row.hash,
                parentHash: row.parent_hash,
                stateRoot: row.state_root,
                timestamp: BigInt(row.timestamp),
                transactionCount: row.transaction_count,
                gasUsed: BigInt(row.gas_used),
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get last block:', error);
            throw error;
        }
    }
    async saveBatch(batch) {
        const query = `
      INSERT INTO batches (state_root, transaction_root, l2_block_number, l1_transaction_hash, status, submitted_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
        try {
            const result = await this.pool.query(query, [
                batch.stateRoot,
                batch.transactionRoot,
                batch.l2BlockNumber.toString(),
                batch.l1TransactionHash,
                batch.status,
                batch.submittedAt,
            ]);
            return BigInt(result.rows[0].id);
        }
        catch (error) {
            logger_1.logger.error('Failed to save batch:', error);
            throw error;
        }
    }
    async updateBatchStatus(id, status, l1TxHash = null) {
        const query = `UPDATE batches SET status = $1, l1_transaction_hash = $2, submitted_at = NOW() WHERE id = $3`;
        try {
            await this.pool.query(query, [status, l1TxHash, id.toString()]);
        }
        catch (error) {
            logger_1.logger.error('Failed to update batch status:', error);
            throw error;
        }
    }
    async saveWithdrawal(withdrawal) {
        const query = `
      INSERT INTO withdrawals (
        withdrawal_id, l2_token, from_address, to_address, amount,
        l2_withdrawal_nonce, l2_block_number, status, initiated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (withdrawal_id) DO NOTHING
    `;
        try {
            await this.pool.query(query, [
                withdrawal.withdrawalId,
                withdrawal.l2Token,
                withdrawal.fromAddress,
                withdrawal.toAddress,
                withdrawal.amount,
                withdrawal.l2WithdrawalNonce,
                withdrawal.l2BlockNumber.toString(),
                withdrawal.status,
                withdrawal.initiatedAt,
            ]);
        }
        catch (error) {
            logger_1.logger.error('Failed to save withdrawal:', error);
            throw error;
        }
    }
    async getWithdrawalsByAddress(address) {
        const query = `SELECT * FROM withdrawals_with_status WHERE from_address = $1 ORDER BY initiated_at DESC`;
        try {
            const result = await this.pool.query(query, [address]);
            return result.rows.map(row => ({
                id: row.id,
                withdrawalId: row.withdrawal_id,
                l2Token: row.l2_token,
                fromAddress: row.from_address,
                toAddress: row.to_address,
                amount: row.amount,
                l2WithdrawalNonce: row.l2_withdrawal_nonce,
                l2BlockNumber: BigInt(row.l2_block_number),
                l1TransactionHash: row.l1_transaction_hash,
                l1FinalizeHash: row.l1_finalize_hash,
                status: row.status,
                initiatedAt: row.initiated_at,
                finalizedAt: row.finalized_at,
                displayStatus: row.display_status,
                secondsRemaining: BigInt(row.seconds_remaining)
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get withdrawals:', error);
            throw error;
        }
    }
    async close() {
        await this.pool.end();
        logger_1.logger.info('Database connection closed');
    }
}
exports.DatabaseService = DatabaseService;
//# sourceMappingURL=database.js.map