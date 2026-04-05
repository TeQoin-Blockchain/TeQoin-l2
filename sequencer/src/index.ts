import express from 'express';
import { getConfig } from './config/config';
import { initDatabase, closeDatabase } from './database/connection';
import { SequencerManagerService } from './services/sequencer-manager.service';
import { logger, logService } from './utils/logger';
import { HealthCheckResponse } from './types';

// ═══════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════

let sequencerManager: SequencerManagerService | null = null;
let healthCheckServer: any = null;

function formatUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return { error };
  }

  return { error: String(error) };
}

async function main() {
  try {
    logger.info('═'.repeat(60));
    logger.info('🚀 L2 SEQUENCER SERVICE');
    logger.info('═'.repeat(60));
    
    // Load configuration
    const config = getConfig();
    
    // Initialize database
    await initDatabase(config.database.url);
    
    // Create sequencer manager
    sequencerManager = new SequencerManagerService(config);
    
    // Start health check server
    await startHealthCheckServer(config.healthCheck.port);
    
    // Start all services
    await sequencerManager.startAll();
    
    logger.info('═'.repeat(60));
    logger.info('✅ SEQUENCER SERVICE RUNNING');
    logger.info(`📡 Health check: http://localhost:${config.healthCheck.port}/health`);
    logger.info('═'.repeat(60));
    
  } catch (error: any) {
    logger.error('Failed to start sequencer service', { 
      error: error?.message || String(error),
      code: error?.code,
      stack: error?.stack
    });
    process.exit(1);
  }
}

/**
 * Start health check HTTP server
 */
async function startHealthCheckServer(port: number): Promise<void> {
  const app = express();
  const stringifyJson = (value: unknown) =>
    JSON.stringify(value, (_key, current) => (typeof current === 'bigint' ? current.toString() : current));
  
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      if (!sequencerManager) {
        return res.status(503).json({
          status: 'unhealthy',
          message: 'Sequencer manager not initialized',
        });
      }
      
      const serviceStatus = sequencerManager.getServiceStatus();
      const stats = await sequencerManager.getStats();
      const uptime = sequencerManager.getUptime();
      const isHealthy = sequencerManager.isHealthy();
      
      const response: HealthCheckResponse = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date(),
        services: serviceStatus,
        stats,
        uptime,
        relayer: sequencerManager.getRelayerHealth(),
      };
      
      res
        .status(isHealthy ? 200 : 503)
        .type('application/json')
        .send(stringifyJson(response));
      
    } catch (error) {
      logger.error('Health check failed', { error });
      res.status(500).json({
        status: 'error',
        message: 'Health check failed',
      });
    }
  });
  
  // Root endpoint
  app.get('/', (req, res) => {
    res
      .type('application/json')
      .send(stringifyJson({
      service: 'L2 Sequencer Service',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: '/health',
      },
    }));
  });
  
  // Start server
  healthCheckServer = app.listen(port, () => {
    logService('HEALTH-CHECK', `Server started on port ${port}`);
  });
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Stop sequencer services
    if (sequencerManager) {
      await sequencerManager.stopAll();
    }
    
    // Close health check server
    if (healthCheckServer) {
      healthCheckServer.close();
    }
    
    // Close database
    await closeDatabase();
    
    logger.info('Graceful shutdown completed');
    const isFailureSignal = signal === 'uncaughtException' || signal === 'unhandledRejection';
    process.exit(isFailureSignal ? 1 : 0);
    
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', formatUnknownError(error));
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', formatUnknownError(reason));
  shutdown('unhandledRejection');
});

// Start the service
main();
