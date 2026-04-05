import { Pool } from 'pg';
import config from '../config';
import logger from '../utils/logger';

export const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  logger.debug('Database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', { error: err.message });
});

export async function query<T>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return result.rows;
  } catch (error: any) {
    logger.error('Query error', { text, error: error.message });
    throw error;
  }
}

export async function getClient() {
  return await pool.connect();
}

export default { pool, query, getClient };