export declare class RedisService {
    private client;
    constructor(config: {
        host: string;
        port: number;
    });
    pushTransaction(txHash: string): Promise<void>;
    popTransaction(): Promise<string | null>;
    getTransactionCount(): Promise<number>;
    clearTransactions(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=redis.d.ts.map