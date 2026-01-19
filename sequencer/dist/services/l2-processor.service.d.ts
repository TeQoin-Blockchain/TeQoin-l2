import { Config } from '../types';
export declare class L2ProcessorService {
    private config;
    private provider;
    private wallet;
    private contract;
    private isRunning;
    private intervalId;
    constructor(config: Config);
    /**
     * Start processing deposits
     */
    start(): Promise<void>;
    /**
     * Process pending deposits
     */
    private processDeposits;
    /**
     * Process single deposit
     */
    private processDeposit;
    /**
     * Stop processing
     */
    stop(): Promise<void>;
    /**
     * Check if service is running
     */
    isActive(): boolean;
}
export default L2ProcessorService;
//# sourceMappingURL=l2-processor.service.d.ts.map