"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerkleTree = void 0;
exports.buildTransactionRoot = buildTransactionRoot;
const ethers_1 = require("ethers");
class MerkleTree {
    leaves;
    constructor(states) {
        // Create leaves from state entries
        this.leaves = states.map(state => ethers_1.ethers.keccak256(ethers_1.ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'uint256'], [state.address, state.balance, state.nonce])));
    }
    getRoot() {
        if (this.leaves.length === 0) {
            return ethers_1.ethers.ZeroHash;
        }
        let currentLevel = [...this.leaves];
        while (currentLevel.length > 1) {
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    const combined = ethers_1.ethers.concat([currentLevel[i], currentLevel[i + 1]]);
                    nextLevel.push(ethers_1.ethers.keccak256(combined));
                }
                else {
                    nextLevel.push(currentLevel[i]);
                }
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
}
exports.MerkleTree = MerkleTree;
/**
 * Build a simple merkle root from transaction/block hashes
 * Returns ethers.ZeroHash if no hashes provided
 */
function buildTransactionRoot(hashes) {
    // Return zero hash if empty
    if (hashes.length === 0) {
        return ethers_1.ethers.ZeroHash;
    }
    // For single hash, return it directly
    if (hashes.length === 1) {
        return hashes[0];
    }
    // Build merkle tree from hashes
    let currentLevel = [...hashes];
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            if (i + 1 < currentLevel.length) {
                // Combine two hashes
                const combined = ethers_1.ethers.concat([currentLevel[i], currentLevel[i + 1]]);
                nextLevel.push(ethers_1.ethers.keccak256(combined));
            }
            else {
                // Odd number - carry forward
                nextLevel.push(currentLevel[i]);
            }
        }
        currentLevel = nextLevel;
    }
    return currentLevel[0];
}
//# sourceMappingURL=merkle.js.map