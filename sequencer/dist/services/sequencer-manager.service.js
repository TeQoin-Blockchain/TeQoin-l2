"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequencerManagerService = void 0;
const types_1 = require("../types");
const logger_1 = require("../utils/logger");
const models_1 = require("../database/models");
const l1_listener_service_1 = require("./l1-listener.service");
const l2_processor_service_1 = require("./l2-processor.service");
const l2_withdrawal_listener_service_1 = require("./l2-withdrawal-listener.service");
const batch_submitter_service_1 = require("./batch-submitter.service");
const block_builder_service_1 = __importDefault(require("./block-builder.service"));
// ═══════════════════════════════════════════════════════
// SEQUENCER MANAGER SERVICE
// Purpose: Orchestrate all services
// ═══════════════════════════════════════════════════════
class SequencerManagerService {
    config;
    blockBuilder;
    l1Listener;
    l2Processor;
    l2WithdrawalListener;
    batchSubmitter;
    serviceStatus = {
        l1Listener: types_1.ServiceState.STOPPED,
        l2Processor: types_1.ServiceState.STOPPED,
        l2WithdrawalListener: types_1.ServiceState.STOPPED,
        batchSubmitter: types_1.ServiceState.STOPPED,
    };
    startTime = new Date();
    constructor(config) {
        this.config = config;
        this.blockBuilder = new block_builder_service_1.default(config);
        this.l1Listener = new l1_listener_service_1.L1ListenerService(config);
        this.l2Processor = new l2_processor_service_1.L2ProcessorService(config);
        this.l2WithdrawalListener = new l2_withdrawal_listener_service_1.L2WithdrawalListenerService(config);
        this.batchSubmitter = new batch_submitter_service_1.BatchSubmitterService(config);
    }
    /**
     * Start all services
     */
    async startAll() {
        (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
        (0, logger_1.logService)('SEQUENCER-MANAGER', '🚀 STARTING SEQUENCER SERVICE');
        (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
        try {
            // Start Block Builder
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Starting Block Builder...');
            await this.blockBuilder.start();
            // Start L1 Listener
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Starting L1 Listener...');
            this.serviceStatus.l1Listener = types_1.ServiceState.STARTING;
            await this.l1Listener.start();
            this.serviceStatus.l1Listener = types_1.ServiceState.RUNNING;
            // Start L2 Processor
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Starting L2 Processor...');
            this.serviceStatus.l2Processor = types_1.ServiceState.STARTING;
            await this.l2Processor.start();
            this.serviceStatus.l2Processor = types_1.ServiceState.RUNNING;
            // Start L2 Withdrawal Listener
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Starting L2 Withdrawal Listener...');
            this.serviceStatus.l2WithdrawalListener = types_1.ServiceState.STARTING;
            await this.l2WithdrawalListener.start();
            this.serviceStatus.l2WithdrawalListener = types_1.ServiceState.RUNNING;
            // Start Batch Submitter
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Starting Batch Submitter...');
            this.serviceStatus.batchSubmitter = types_1.ServiceState.STARTING;
            await this.batchSubmitter.start();
            this.serviceStatus.batchSubmitter = types_1.ServiceState.RUNNING;
            (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
            (0, logger_1.logService)('SEQUENCER-MANAGER', '✅ ALL SERVICES STARTED SUCCESSFULLY');
            (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
            this.startHealthCheckMonitor();
        }
        catch (error) {
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Failed to start services', { error });
            this.updateErrorStates();
            throw error;
        }
    }
    /**
     * Stop all services
     */
    async stopAll() {
        (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
        (0, logger_1.logService)('SEQUENCER-MANAGER', '🛑 STOPPING SEQUENCER SERVICE');
        (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
        try {
            // Stop Block Builder first
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Stopping Block Builder...');
            await this.blockBuilder.stop();
            // Stop Batch Submitter first
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Stopping Batch Submitter...');
            this.serviceStatus.batchSubmitter = types_1.ServiceState.STOPPING;
            await this.batchSubmitter.stop();
            this.serviceStatus.batchSubmitter = types_1.ServiceState.STOPPED;
            // Stop L2 Withdrawal Listener
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Stopping L2 Withdrawal Listener...');
            this.serviceStatus.l2WithdrawalListener = types_1.ServiceState.STOPPING;
            await this.l2WithdrawalListener.stop();
            this.serviceStatus.l2WithdrawalListener = types_1.ServiceState.STOPPED;
            // Stop L2 Processor
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Stopping L2 Processor...');
            this.serviceStatus.l2Processor = types_1.ServiceState.STOPPING;
            await this.l2Processor.stop();
            this.serviceStatus.l2Processor = types_1.ServiceState.STOPPED;
            // Stop L1 Listener last
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Stopping L1 Listener...');
            this.serviceStatus.l1Listener = types_1.ServiceState.STOPPING;
            await this.l1Listener.stop();
            this.serviceStatus.l1Listener = types_1.ServiceState.STOPPED;
            (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
            (0, logger_1.logService)('SEQUENCER-MANAGER', '✅ ALL SERVICES STOPPED');
            (0, logger_1.logService)('SEQUENCER-MANAGER', '═══════════════════════════════════════');
        }
        catch (error) {
            (0, logger_1.logService)('SEQUENCER-MANAGER', 'Error while stopping services', { error });
            throw error;
        }
    }
    /**
     * Get service status
     */
    getServiceStatus() {
        return { ...this.serviceStatus };
    }
    /**
     * Get statistics
     */
    async getStats() {
        return await (0, models_1.getStats)();
    }
    /**
     * Get uptime in seconds
     */
    getUptime() {
        return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    }
    /**
     * Check overall health
     */
    isHealthy() {
        return (this.serviceStatus.l1Listener === types_1.ServiceState.RUNNING &&
            this.serviceStatus.l2Processor === types_1.ServiceState.RUNNING &&
            this.serviceStatus.l2WithdrawalListener === types_1.ServiceState.RUNNING &&
            this.serviceStatus.batchSubmitter === types_1.ServiceState.RUNNING);
    }
    /**
     * Update all service states to ERROR
     */
    updateErrorStates() {
        if (!this.l1Listener.isActive()) {
            this.serviceStatus.l1Listener = types_1.ServiceState.ERROR;
        }
        if (!this.l2Processor.isActive()) {
            this.serviceStatus.l2Processor = types_1.ServiceState.ERROR;
        }
        if (!this.l2WithdrawalListener.isActive()) {
            this.serviceStatus.l2WithdrawalListener = types_1.ServiceState.ERROR;
        }
        if (!this.batchSubmitter.isActive()) {
            this.serviceStatus.batchSubmitter = types_1.ServiceState.ERROR;
        }
    }
    /**
     * Start health check monitor (every minute)
     */
    startHealthCheckMonitor() {
        setInterval(() => {
            if (!this.isHealthy()) {
                logger_1.logger.warn('Some services are not healthy', {
                    status: this.serviceStatus,
                });
            }
            else {
                (0, logger_1.logService)('SEQUENCER-MANAGER', 'Health check: All services running');
            }
        }, 60000); // Every minute
    }
}
exports.SequencerManagerService = SequencerManagerService;
exports.default = SequencerManagerService;
//# sourceMappingURL=sequencer-manager.service.js.map