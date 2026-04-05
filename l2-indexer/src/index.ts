import * as dotenv from 'dotenv';
dotenv.config();
import { APIServer } from './api/server';
import { BlockListener } from './indexer/block-listener';
import { BridgeListener } from './indexer/bridge-listener';
import { setState } from './database/queries/state';
import cacheService from './services/cache.service';
import logger from './utils/logger';
import { pool } from './database/connection';

/**
 * TeQoin L2 Indexer
 * Main Application Entry Point
 */

class Application {
  private apiServer: APIServer;
  private blockListener: BlockListener;
  private bridgeListener: BridgeListener;

  constructor() {
    this.apiServer = new APIServer();
    this.blockListener = new BlockListener();
    this.bridgeListener = new BridgeListener();
  }

  async start(): Promise<void> {
    logger.info('='.repeat(60));
    logger.info('TeQoin L2 Indexer Starting...');
    logger.info('='.repeat(60));

    try {
      // Test database connection
      await pool.query('SELECT 1');
      logger.info('✓ Database connected');

      // Set start time
      await setState('indexer_started_at', new Date().toISOString());

      // Start API server
      await this.apiServer.start();
      logger.info('✓ API Server started');

      // Start block indexer
      await this.blockListener.start();
      logger.info('✓ Block Listener started');

      // Start bridge indexer
      await this.bridgeListener.start();
      logger.info('✓ Bridge Listener started');

      logger.info('='.repeat(60));
      logger.info('TeQoin L2 Indexer Running');
      logger.info('='.repeat(60));
    } catch (error: any) {
      logger.error('Failed to start application', { error: error.message });
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    logger.info('Shutting down...');

    try {
      await this.bridgeListener.stop();
      logger.info('✓ Bridge Listener stopped');

      await this.blockListener.stop();
      logger.info('✓ Block Listener stopped');

      await this.apiServer.stop();
      logger.info('✓ API Server stopped');

      await cacheService.close();
      logger.info('✓ Cache closed');

      await pool.end();
      logger.info('✓ Database disconnected');

      logger.info('Shutdown complete');
    } catch (error: any) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }
}

// Create application instance
const app = new Application();

// Start application
app.start().catch((error) => {
  logger.error('Fatal error', { error: error.message });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await app.stop();
  process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});
