import { Config } from '../types';
export declare class BlockBuilderService {
    private config;
    private l2Provider;
    private engineAPI;
    private isRunning;
    private intervalId;
    private blockInterval;
    private sequencerAddress;
    private lastBlockHash;
    private lastBlockNumber;
    constructor(config: Config);
    /**
     * Start block building
     */
    start(): Promise<void>;
    /**
     * Initialize state from current chain
     */
    private initializeState;
    private buildAndSubmitBlock;
    /**
     * Stop block building
     */
    stop(): Promise<void>;
    /**
     * Check if service is running
     */
    isActive(): boolean;
    /**
     * Get current block number
     */
    getCurrentBlockNumber(): number;
}
export default BlockBuilderService;
//# sourceMappingURL=block-builder.service.d.ts.map