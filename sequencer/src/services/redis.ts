import Redis from 'ioredis';
import { logger } from '../utils/logger';

export class RedisService {
  private client: Redis;

  constructor(config: { host: string; port: number }) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      logger.info('✅ Redis connected');
    });

    this.client.on('error', (error) => {
      logger.error('❌ Redis error:', error);
    });
  }

  async pushTransaction(txHash: string): Promise<void> {
    await this.client.lpush('pending_txs', txHash);
  }

  async popTransaction(): Promise<string | null> {
    return await this.client.rpop('pending_txs');
  }

  async getTransactionCount(): Promise<number> {
    return await this.client.llen('pending_txs');
  }

  async clearTransactions(): Promise<void> {
    await this.client.del('pending_txs');
  }

  async close(): Promise<void> {
    await this.client.quit();
    logger.info('Redis connection closed');
  }
}