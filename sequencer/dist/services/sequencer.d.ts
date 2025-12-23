import { DatabaseService } from './database';
import { RedisService } from './redis';
export interface SequencerConfig {
    l1RpcUrl: string;
    l2RpcUrl: string;
    sequencerPrivateKey: string;
    l1BridgeAddress: string;
    l1StateCommitmentAddress: string;
    l2BridgeAddress: string;
    blockTimeMs: number;
    batchIntervalMs: number;
    batchSize: number;
}
export declare class Sequencer {
    private l1Provider;
    private l2Provider;
    private sequencerWallet;
    private l1Bridge;
    private l1StateCommitment;
    private l2Bridge;
    private db;
    private redis;
    private config;
    private currentBlockNumber;
    private blockInterval;
    private batchInterval;
    private isRunning;
    constructor(config: SequencerConfig, db: DatabaseService, redis: RedisService);
    start(): Promise<void>;
    private startDepositListener;
    private startWithdrawalListener;
    private startBlockProduction;
    private produceBlock;
    private startBatchSubmission;
    private submitBatch;
    private getL2State;
    stop(): Promise<void>;
}
//# sourceMappingURL=sequencer.d.ts.map