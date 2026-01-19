import { Config } from '../types';
export declare class BatchSubmitterService {
    private config;
    private l1Provider;
    private l2Provider;
    private wallet;
    private contract;
    private isRunning;
    private isSubmitting;
    private intervalId;
    constructor(config: Config);
    /**
     * Start batch submission
     */
    start(): Promise<void>;
    /**
     * Submit batch to L1 at rotation boundary
     */
    private submitBatch;
    /**
     * Collect block data from L2
     */
    private collectBlockData;
    /**
     * Stop batch submission
     */
    stop(): Promise<void>;
    /**
     * Check if service is running
     */
    isActive(): boolean;
}
export default BatchSubmitterService;
//# sourceMappingURL=batch-submitter.service.d.ts.map