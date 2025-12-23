"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
class RedisService {
    client;
    constructor(config) {
        this.client = new ioredis_1.default({
            host: config.host,
            port: config.port,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });
        this.client.on('connect', () => {
            logger_1.logger.info('✅ Redis connected');
        });
        this.client.on('error', (error) => {
            logger_1.logger.error('❌ Redis error:', error);
        });
    }
    async pushTransaction(txHash) {
        await this.client.lpush('pending_txs', txHash);
    }
    async popTransaction() {
        return await this.client.rpop('pending_txs');
    }
    async getTransactionCount() {
        return await this.client.llen('pending_txs');
    }
    async clearTransactions() {
        await this.client.del('pending_txs');
    }
    async close() {
        await this.client.quit();
        logger_1.logger.info('Redis connection closed');
    }
}
exports.RedisService = RedisService;
//# sourceMappingURL=redis.js.map