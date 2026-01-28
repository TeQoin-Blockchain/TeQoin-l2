export interface ExecutionPayload {
    parentHash: string;
    feeRecipient: string;
    stateRoot: string;
    receiptsRoot: string;
    logsBloom: string;
    prevRandao: string;
    blockNumber: string;
    gasLimit: string;
    gasUsed: string;
    timestamp: string;
    extraData: string;
    baseFeePerGas: string;
    blockHash: string;
    transactions: string[];
}
export interface ForkchoiceState {
    headBlockHash: string;
    safeBlockHash: string;
    finalizedBlockHash: string;
}
export interface PayloadAttributes {
    timestamp: string;
    prevRandao: string;
    suggestedFeeRecipient: string;
    withdrawals?: Withdrawal[];
}
export interface Withdrawal {
    index: string;
    validatorIndex: string;
    address: string;
    amount: string;
}
export interface ExecutionPayloadV2 extends ExecutionPayload {
    withdrawals: Withdrawal[];
}
export declare class EngineAPIClient {
    private jwt;
    private endpoint;
    constructor(engineEndpoint: string, jwtSecretPath: string);
    /**
     * Make authenticated request to Engine API
     */
    private request;
    /**
     * engine_newPayloadV1 - Submit new execution payload
     */
    forkchoiceUpdatedV2(forkchoiceState: ForkchoiceState, payloadAttributes?: PayloadAttributes): Promise<{
        payloadStatus: {
            status: 'VALID' | 'INVALID' | 'SYNCING';
            latestValidHash: string | null;
            validationError: string | null;
        };
        payloadId: string | null;
    }>;
    getPayloadV2(payloadId: string): Promise<{
        executionPayload: ExecutionPayloadV2;
        blockValue: string;
    }>;
    newPayloadV2(payload: ExecutionPayloadV2): Promise<{
        status: 'VALID' | 'INVALID' | 'SYNCING' | 'ACCEPTED';
        latestValidHash: string | null;
        validationError: string | null;
    }>;
    newPayloadV1(payload: ExecutionPayload): Promise<{
        status: 'VALID' | 'INVALID' | 'SYNCING' | 'ACCEPTED';
        latestValidHash: string | null;
        validationError: string | null;
    }>;
    /**
     * engine_forkchoiceUpdatedV1 - Update fork choice
     */
    forkchoiceUpdatedV1(forkchoiceState: ForkchoiceState, payloadAttributes?: PayloadAttributes): Promise<{
        payloadStatus: {
            status: 'VALID' | 'INVALID' | 'SYNCING';
            latestValidHash: string | null;
            validationError: string | null;
        };
        payloadId: string | null;
    }>;
    /**
     * engine_getPayloadV1 - Get execution payload by ID
     */
    getPayloadV1(payloadId: string): Promise<ExecutionPayload>;
    /**
     * Check Engine API connectivity
     */
    ping(): Promise<boolean>;
}
export default EngineAPIClient;
//# sourceMappingURL=engine-api-client.d.ts.map