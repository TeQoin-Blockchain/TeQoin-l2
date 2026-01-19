import { Config, ServiceStatus, SequencerStats } from '../types';
export declare class SequencerManagerService {
    private config;
    private blockBuilder;
    private l1Listener;
    private l2Processor;
    private l2WithdrawalListener;
    private batchSubmitter;
    private serviceStatus;
    private startTime;
    constructor(config: Config);
    /**
     * Start all services
     */
    startAll(): Promise<void>;
    /**
     * Stop all services
     */
    stopAll(): Promise<void>;
    /**
     * Get service status
     */
    getServiceStatus(): ServiceStatus;
    /**
     * Get statistics
     */
    getStats(): Promise<SequencerStats>;
    /**
     * Get uptime in seconds
     */
    getUptime(): number;
    /**
     * Check overall health
     */
    isHealthy(): boolean;
    /**
     * Update all service states to ERROR
     */
    private updateErrorStates;
    /**
     * Start health check monitor (every minute)
     */
    private startHealthCheckMonitor;
}
export default SequencerManagerService;
//# sourceMappingURL=sequencer-manager.service.d.ts.map