export interface Block {
    number: bigint;
    hash: string;
    parentHash: string;
    stateRoot: string;
    timestamp: bigint;
    transactionCount: number;
    gasUsed: bigint;
}
export interface Batch {
    id?: bigint;
    stateRoot: string;
    transactionRoot: string;
    l2BlockNumber: bigint;
    l1TransactionHash: string | null;
    status: 'pending' | 'submitted' | 'finalized' | 'challenged';
    submittedAt: Date | null;
}
export interface Withdrawal {
    id?: number;
    withdrawalId: string;
    l2Token: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
    l2WithdrawalNonce: string;
    l2BlockNumber: bigint;
    l1TransactionHash: string | null;
    l1FinalizeHash: string | null;
    status: 'pending' | 'ready' | 'finalized' | 'challenged';
    initiatedAt: Date;
    finalizedAt: Date | null;
    secondsRemaining?: bigint;
    displayStatus?: string;
}
export declare class DatabaseService {
    private pool;
    constructor(config: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    });
    connect(): Promise<void>;
    saveBlock(block: Block): Promise<void>;
    getLastBlock(): Promise<Block | null>;
    saveBatch(batch: Omit<Batch, 'id'>): Promise<bigint>;
    updateBatchStatus(id: bigint, status: string, l1TxHash?: string | null): Promise<void>;
    saveWithdrawal(withdrawal: Omit<Withdrawal, 'id' | 'secondsRemaining' | 'displayStatus'>): Promise<void>;
    getWithdrawalsByAddress(address: string): Promise<Withdrawal[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=database.d.ts.map