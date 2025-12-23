import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { DatabaseService } from './services/database';
import { RedisService } from './services/redis';
import { Sequencer, SequencerConfig } from './services/sequencer';

dotenv.config();

async function main() {
  logger.info('════════════════════════════════════════════════════════');
  logger.info('           L2 ROLLUP SEQUENCER - PRODUCTION             ');
  logger.info('════════════════════════════════════════════════════════\n');

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
      logger.error(`❌ Missing environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  // Initialize database
  const db = new DatabaseService({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'sequencer',
    user: process.env.POSTGRES_USER || 'sequencer',
    password: process.env.POSTGRES_PASSWORD || '',
  });

  await db.connect();

  // Initialize Redis
  const redis = new RedisService({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });

  // Initialize Sequencer
  const config: SequencerConfig = {
    l1RpcUrl: process.env.L1_RPC_URL!,
    l2RpcUrl: process.env.L2_RPC_URL!,
    sequencerPrivateKey: process.env.SEQUENCER_PRIVATE_KEY!,
    l1BridgeAddress: process.env.L1_BRIDGE_ADDRESS!,
    l1StateCommitmentAddress: process.env.L1_STATE_COMMITMENT_ADDRESS!,
    l2BridgeAddress: process.env.L2_BRIDGE_ADDRESS!,
    blockTimeMs: parseInt(process.env.BLOCK_TIME_MS || '5000'),
    batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS || '60000'),
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
  };

  const sequencer = new Sequencer(config, db, redis);

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
  logger.error('Fatal error:', error);
  process.exit(1);
});
