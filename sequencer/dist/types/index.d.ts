export interface Config {
    l1: {
        rpcUrl: string;
        wsUrl: string;
        chainId: number;
        diamondAddress: string;
    };
    l2: {
        rpcUrl: string;
        wsUrl: string;
        chainId: number;
        engineUrl: string;
        jwtSecretPath: string;
        contracts: {
            teqToken: string;
            bridge: string;
            staking: string;
        };
    };
    sequencer: {
        address: string;
        privateKey: string;
    };
    batch: {
        size: number;
        interval: number;
        gasLimit: number;
    };
    database: {
        url: string;
    };
    logging: {
        level: string;
        file: string;
    };
    healthCheck: {
        port: number;
    };
    retry: {
        attempts: number;
        delay: number;
    };
    maxConcurrentDeposits: number;
}
export interface Deposit {
    id?: number;
    depositId: string;
    tokenAddress: string;
    recipient: string;
    amount: string;
    l1BlockNumber: bigint;
    l1TxHash: string;
    processed: boolean;
    l2TxHash?: string;
    createdAt?: Date;
    processedAt?: Date;
}
export interface DepositEvent {
    depositId: string;
    token: string;
    recipient: string;
    amount: bigint;
    blockNumber: bigint;
    transactionHash: string;
}
export interface Withdrawal {
    id?: number;
    withdrawalId: string;
    tokenAddress: string;
    sender: string;
    recipient: string;
    amount: string;
    l2BlockNumber: bigint;
    l2TxHash: string;
    queued: boolean;
    finalized: boolean;
    l1TxHash?: string;
    createdAt?: Date;
    queuedAt?: Date;
    finalizedAt?: Date;
}
export interface WithdrawalEvent {
    withdrawalId: string;
    token: string;
    from: string;
    to: string;
    amount: bigint;
    nonce: bigint;
    blockNumber: bigint;
    transactionHash: string;
}
export interface Batch {
    id?: number;
    batchNumber: bigint;
    l2StartBlock: bigint;
    l2EndBlock: bigint;
    stateRoot: string;
    transactionsRoot: string;
    l1TxHash?: string;
    submitted: boolean;
    createdAt?: Date;
    submittedAt?: Date;
}
export interface BatchData {
    startBlock: bigint;
    endBlock: bigint;
    stateRoot: string;
    transactionsRoot: string;
    compressedData: string;
}
export interface ServiceStatus {
    l1Listener: ServiceState;
    l2Processor: ServiceState;
    l2WithdrawalListener: ServiceState;
    batchSubmitter: ServiceState;
}
export declare enum ServiceState {
    STOPPED = "stopped",
    STARTING = "starting",
    RUNNING = "running",
    ERROR = "error",
    STOPPING = "stopping"
}
export interface SequencerStats {
    depositsProcessed: number;
    withdrawalsQueued: number;
    batchesSubmitted: number;
    lastBatchBlock: bigint;
    lastDepositTime?: Date;
    lastWithdrawalTime?: Date;
    lastBatchTime?: Date;
}
export interface HealthCheckResponse {
    status: 'healthy' | 'unhealthy';
    timestamp: Date;
    services: ServiceStatus;
    stats: SequencerStats;
    uptime: number;
}
export declare class SequencerError extends Error {
    code: string;
    details?: any | undefined;
    constructor(message: string, code: string, details?: any | undefined);
}
export declare enum ErrorCode {
    CONFIG_ERROR = "CONFIG_ERROR",
    DATABASE_ERROR = "DATABASE_ERROR",
    RPC_ERROR = "RPC_ERROR",
    CONTRACT_ERROR = "CONTRACT_ERROR",
    PROCESSING_ERROR = "PROCESSING_ERROR",
    BATCH_ERROR = "BATCH_ERROR"
}
//# sourceMappingURL=index.d.ts.map