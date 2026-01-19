import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';
import { SequencerError, ErrorCode } from '../types';

// ═══════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════

let pool: Pool | null = null;

/**
 * Initialize database connection pool
 */
export async function initDatabase(databaseUrl: string): Promise<void> {
  logger.info('Initializing database connection...');
  
  try {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    logger.info('Database connected successfully');
    
    // Run migrations
    await runMigrations();
    
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw new SequencerError(
      'Database connection failed',
      ErrorCode.DATABASE_ERROR,
      error
    );
  }
}

/**
 * Get database pool
 */
export function getPool(): Pool {
  if (!pool) {
    throw new SequencerError(
      'Database not initialized',
      ErrorCode.DATABASE_ERROR
    );
  }
  return pool;
}

/**
 * Execute query
 */
export async function query(text: string, params?: any[]): Promise<any> {
  const pool = getPool();
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    logger.error('Database query failed', { text, error });
    throw error;
  }
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    logger.info('Closing database connection...');
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
}

/**
 * Run database migrations
 */
async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  
  const migrations = [
    // Create deposits table
    `
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      deposit_id VARCHAR(66) UNIQUE NOT NULL,
      token_address VARCHAR(42) NOT NULL,
      recipient VARCHAR(42) NOT NULL,
      amount VARCHAR(78) NOT NULL,
      l1_block_number BIGINT NOT NULL,
      l1_tx_hash VARCHAR(66) NOT NULL,
      processed BOOLEAN DEFAULT FALSE,
      l2_tx_hash VARCHAR(66),
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    );
    `,
    
    // Create withdrawals table
    `
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      withdrawal_id VARCHAR(66) UNIQUE NOT NULL,
      token_address VARCHAR(42) NOT NULL,
      sender VARCHAR(42) NOT NULL,
      recipient VARCHAR(42) NOT NULL,
      amount VARCHAR(78) NOT NULL,
      l2_block_number BIGINT NOT NULL,
      l2_tx_hash VARCHAR(66) NOT NULL,
      queued BOOLEAN DEFAULT FALSE,
      finalized BOOLEAN DEFAULT FALSE,
      l1_tx_hash VARCHAR(66),
      created_at TIMESTAMP DEFAULT NOW(),
      queued_at TIMESTAMP,
      finalized_at TIMESTAMP
    );
    `,
    
    // Create batches table
    `
    CREATE TABLE IF NOT EXISTS batches (
      id SERIAL PRIMARY KEY,
      batch_number BIGINT UNIQUE NOT NULL,
      l2_start_block BIGINT NOT NULL,
      l2_end_block BIGINT NOT NULL,
      state_root VARCHAR(66) NOT NULL,
      transactions_root VARCHAR(66) NOT NULL,
      l1_tx_hash VARCHAR(66),
      submitted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      submitted_at TIMESTAMP
    );
    `,
    
    // Create sequencer_state table
    `
    CREATE TABLE IF NOT EXISTS sequencer_state (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    `,
    
    // Create indexes
    `CREATE INDEX IF NOT EXISTS idx_deposits_processed ON deposits(processed);`,
    `CREATE INDEX IF NOT EXISTS idx_deposits_l1_block ON deposits(l1_block_number);`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_queued ON withdrawals(queued);`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_l2_block ON withdrawals(l2_block_number);`,
    `CREATE INDEX IF NOT EXISTS idx_batches_submitted ON batches(submitted);`,
  ];
  
  for (const migration of migrations) {
    try {
      await query(migration);
    } catch (error) {
      logger.error('Migration failed', { migration, error });
      throw error;
    }
  }
  
  logger.info('Database migrations completed');
}

export default {
  initDatabase,
  getPool,
  query,
  closeDatabase,
};