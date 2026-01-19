"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config/config");
const connection_1 = require("./database/connection");
const sequencer_manager_service_1 = require("./services/sequencer-manager.service");
const logger_1 = require("./utils/logger");
// ═══════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════
let sequencerManager = null;
let healthCheckServer = null;
async function main() {
    try {
        logger_1.logger.info('═'.repeat(60));
        logger_1.logger.info('🚀 L2 SEQUENCER SERVICE');
        logger_1.logger.info('═'.repeat(60));
        // Load configuration
        const config = (0, config_1.getConfig)();
        // Initialize database
        await (0, connection_1.initDatabase)(config.database.url);
        // Create sequencer manager
        sequencerManager = new sequencer_manager_service_1.SequencerManagerService(config);
        // Start health check server
        await startHealthCheckServer(config.healthCheck.port);
        // Start all services
        await sequencerManager.startAll();
        logger_1.logger.info('═'.repeat(60));
        logger_1.logger.info('✅ SEQUENCER SERVICE RUNNING');
        logger_1.logger.info(`📡 Health check: http://localhost:${config.healthCheck.port}/health`);
        logger_1.logger.info('═'.repeat(60));
    }
    catch (error) {
        logger_1.logger.error('Failed to start sequencer service', {
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
async function startHealthCheckServer(port) {
    const app = (0, express_1.default)();
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
            const response = {
                status: isHealthy ? 'healthy' : 'unhealthy',
                timestamp: new Date(),
                services: serviceStatus,
                stats,
                uptime,
            };
            res.status(isHealthy ? 200 : 503).json(response);
        }
        catch (error) {
            logger_1.logger.error('Health check failed', { error });
            res.status(500).json({
                status: 'error',
                message: 'Health check failed',
            });
        }
    });
    // Root endpoint
    app.get('/', (req, res) => {
        res.json({
            service: 'L2 Sequencer Service',
            version: '1.0.0',
            status: 'running',
            endpoints: {
                health: '/health',
            },
        });
    });
    // Start server
    healthCheckServer = app.listen(port, () => {
        (0, logger_1.logService)('HEALTH-CHECK', `Server started on port ${port}`);
    });
}
/**
 * Graceful shutdown
 */
async function shutdown(signal) {
    logger_1.logger.info(`Received ${signal}, starting graceful shutdown...`);
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
        await (0, connection_1.closeDatabase)();
        logger_1.logger.info('Graceful shutdown completed');
        process.exit(0);
    }
    catch (error) {
        logger_1.logger.error('Error during shutdown', { error });
        process.exit(1);
    }
}
// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught exception', { error });
    shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled rejection', { reason });
    shutdown('unhandledRejection');
});
// Start the service
main();
//# sourceMappingURL=index.js.map