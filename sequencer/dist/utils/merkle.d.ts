export interface StateEntry {
    address: string;
    balance: bigint;
    nonce: bigint;
}
export declare class MerkleTree {
    private leaves;
    constructor(states: StateEntry[]);
    getRoot(): string;
}
/**
 * Build a simple merkle root from transaction/block hashes
 * Returns ethers.ZeroHash if no hashes provided
 */
export declare function buildTransactionRoot(hashes: string[]): string;
//# sourceMappingURL=merkle.d.ts.map