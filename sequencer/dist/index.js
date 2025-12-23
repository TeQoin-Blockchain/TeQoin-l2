"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./utils/logger");
const database_1 = require("./services/database");
const redis_1 = require("./services/redis");
const sequencer_1 = require("./services/sequencer");
dotenv_1.default.config();
async function main() {
    logger_1.logger.info('════════════════════════════════════════════════════════');
    logger_1.logger.info('           L2 ROLLUP SEQUENCER - PRODUCTION             ');
    logger_1.logger.info('════════════════════════════════════════════════════════\n');
    // Validate environment
    const requiredEnvVars = [
        'L1_RPC_URL',
        'L2_RPC_URL',
        'SEQUENCER_PRIVATE_KEY',
        'L1_BRIDGE_ADDRESS',
        'L1_STATE_COMMITMENT_ADDRESS',
        'L2_BRIDGE_ADDRESS',
    ];
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            logger_1.logger.error(`❌ Missing environment variable: ${envVar}`);
            process.exit(1);
        }
    }
    // Initialize database
    const db = new database_1.DatabaseService({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'sequencer',
        user: process.env.POSTGRES_USER || 'sequencer',
        password: process.env.POSTGRES_PASSWORD || '',
    });
    await db.connect();
    // Initialize Redis
    const redis = new redis_1.RedisService({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    // Initialize Sequencer
    const config = {
        l1RpcUrl: process.env.L1_RPC_URL,
        l2RpcUrl: process.env.L2_RPC_URL,
        sequencerPrivateKey: process.env.SEQUENCER_PRIVATE_KEY,
        l1BridgeAddress: process.env.L1_BRIDGE_ADDRESS,
        l1StateCommitmentAddress: process.env.L1_STATE_COMMITMENT_ADDRESS,
        l2BridgeAddress: process.env.L2_BRIDGE_ADDRESS,
        blockTimeMs: parseInt(process.env.BLOCK_TIME_MS || '5000'),
        batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || '60000'),
        batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    };
    const sequencer = new sequencer_1.Sequencer(config, db, redis);
    // Start sequencer
    await sequencer.start();
    // Graceful shutdown
    process.on('SIGINT', async () => {
        await sequencer.stop();
        await db.close();
        await redis.close();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await sequencer.stop();
        await db.close();
        await redis.close();
        process.exit(0);
    });
}
main().catch((error) => {
    logger_1.logger.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map