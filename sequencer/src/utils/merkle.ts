import { ethers } from 'ethers';

export interface StateEntry {
  address: string;
  balance: bigint;
  nonce: bigint;
}

export class MerkleTree {
  private leaves: string[];

  constructor(states: StateEntry[]) {
    // Create leaves from state entries
    this.leaves = states.map(state =>
      ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'uint256'],
          [state.address, state.balance, state.nonce]
        )
      )
    );
  }

  getRoot(): string {
    if (this.leaves.length === 0) {
      return ethers.ZeroHash;
    }

    let currentLevel = [...this.leaves];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const combined = ethers.concat([currentLevel[i], currentLevel[i + 1]]);
          nextLevel.push(ethers.keccak256(combined));
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }

      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }
}

/**
 * Build a simple merkle root from transaction/block hashes
 * Returns ethers.ZeroHash if no hashes provided
 */
export function buildTransactionRoot(hashes: string[]): string {
  // Return zero hash if empty
  if (hashes.length === 0) {
    return ethers.ZeroHash;
  }

  // For single hash, return it directly
  if (hashes.length === 1) {
    return hashes[0];
  }

  // Build merkle tree from hashes
  let currentLevel = [...hashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Combine two hashes
        const combined = ethers.concat([currentLevel[i], currentLevel[i + 1]]);
        nextLevel.push(ethers.keccak256(combined));
      } else {
        // Odd number - carry forward
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}