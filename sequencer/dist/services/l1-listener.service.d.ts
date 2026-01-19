import { Config } from '../types';
export declare class L1ListenerService {
    private config;
    private provider;
    private contract;
    private isRunning;
    constructor(config: Config);
    /**
     * Start listening to L1 deposits
     */
    start(): Promise<void>;
    /**
     * Handle deposit event from L1
     */
    private handleDeposit;
    /**
     * Stop listening
     */
    stop(): Promise<void>;
    /**
     * Check if service is running
     */
    isActive(): boolean;
}
export default L1ListenerService;
//# sourceMappingURL=l1-listener.service.d.ts.map