import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

class CacheService {
  private client: Redis | null = null;
  private enabled: boolean = false;
  
  constructor() {
    if (config.redis) {
      try {
        this.client = new Redis(config.redis.url);
        this.enabled = true;
        
        this.client.on('connect', () => {
          logger.info('Redis connected');
        });
        
        this.client.on('error', (err) => {
          logger.error('Redis error', { error: err.message });
          this.enabled = false;
        });
      } catch (error: any) {
        logger.warn('Redis not available, caching disabled', { error: error.message });
        this.enabled = false;
      }
    } else {
      logger.info('Redis not configured, caching disabled');
    }
  }
  
  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled || !this.client) return null;
    
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error: any) {
      logger.error('Cache get error', { key, error: error.message });
      return null;
    }
  }
  
  async set(key: string, value: any, ttl: number = 60): Promise<void> {
    if (!this.enabled || !this.client) return;
    
    try {
      await this.client.setex(key, ttl, JSON.stringify(value));
    } catch (error: any) {
      logger.error('Cache set error', { key, error: error.message });
    }
  }
  
  async del(key: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    
    try {
      await this.client.del(key);
    } catch (error: any) {
      logger.error('Cache delete error', { key, error: error.message });
    }
  }
  
  async flush(): Promise<void> {
    if (!this.enabled || !this.client) return;
    
    try {
      await this.client.flushdb();
      logger.info('Cache flushed');
    } catch (error: any) {
      logger.error('Cache flush error', { error: error.message });
    }
  }
  
  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      logger.info('Redis disconnected');
    }
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
}

export default new CacheService();