import { Config } from '../types';
export declare class L2WithdrawalListenerService {
    private config;
    private provider;
    private contract;
    private isRunning;
    constructor(config: Config);
    /**
     * Start listening to L2 withdrawals
     */
    start(): Promise<void>;
    /**
     * Handle withdrawal event from L2
     */
    private handleWithdrawal;
    /**
     * Stop listening
     */
    stop(): Promise<void>;
    /**
     * Check if service is running
     */
    isActive(): boolean;
}
export default L2WithdrawalListenerService;
//# sourceMappingURL=l2-withdrawal-listener.service.d.ts.map