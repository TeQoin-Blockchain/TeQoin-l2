import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface Block {
  number: bigint;
  hash: string;
  parentHash: string;
  stateRoot: string;
  timestamp: bigint;
  transactionCount: number;
  gasUsed: bigint;
}

export interface Batch {
  id?: bigint;
  stateRoot: string;
  transactionRoot: string;
  l2BlockNumber: bigint;
  l1TransactionHash: string | null;
  status: 'pending' | 'submitted' | 'finalized' | 'challenged';
  submittedAt: Date | null;
}

export interface Withdrawal {
  id?: number;
  withdrawalId: string;
  l2Token: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  l2WithdrawalNonce: string;
  l2BlockNumber: bigint;
  l1TransactionHash: string | null;
  l1FinalizeHash: string | null;
  status: 'pending' | 'ready' | 'finalized' | 'challenged';
  initiatedAt: Date;
  finalizedAt: Date | null;
  secondsRemaining?: bigint;
  displayStatus?: string;
}

export class DatabaseService {
  private pool: Pool;

  constructor(config: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  }) {
    this.pool = new Pool(config);
    logger.info('Database service initialized');
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      logger.info('✅ Database connected successfully');
      client.release();
    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async saveBlock(block: Block): Promise<void> {
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
    } catch (error) {
      logger.error('Failed to save block:', error);
      throw error;
    }
  }

  async getLastBlock(): Promise<Block | null> {
    const query = 'SELECT * FROM blocks ORDER BY number DESC LIMIT 1';
    try {
      const result = await this.pool.query(query);
      if (result.rows.length === 0) return null;
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
    } catch (error) {
      logger.error('Failed to get last block:', error);
      throw error;
    }
  }

  async saveBatch(batch: Omit<Batch, 'id'>): Promise<bigint> {
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
    } catch (error) {
      logger.error('Failed to save batch:', error);
      throw error;
    }
  }

  async updateBatchStatus(id: bigint, status: string, l1TxHash: string | null = null): Promise<void> {
    const query = `UPDATE batches SET status = $1, l1_transaction_hash = $2, submitted_at = NOW() WHERE id = $3`;
    try {
      await this.pool.query(query, [status, l1TxHash, id.toString()]);
    } catch (error) {
      logger.error('Failed to update batch status:', error);
      throw error;
    }
  }

  async saveWithdrawal(withdrawal: Omit<Withdrawal, 'id' | 'secondsRemaining' | 'displayStatus'>): Promise<void> {
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
    } catch (error) {
      logger.error('Failed to save withdrawal:', error);
      throw error;
    }
  }

  async getWithdrawalsByAddress(address: string): Promise<Withdrawal[]> {
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
    } catch (error) {
      logger.error('Failed to get withdrawals:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection closed');
  }
}