// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LibAppStorage
 * @notice Shared storage library for all Diamond facets
 * @dev All facets use this single storage structure to avoid collisions
 */
library LibAppStorage {
    bytes32 constant APP_STORAGE_POSITION = keccak256("teqoin.app.storage");

    struct AppStorage {
        // ═══════════════════════════════════════════════════════
        // BRIDGE STORAGE
        // ═══════════════════════════════════════════════════════
        mapping(bytes32 => Withdrawal) withdrawals;
        mapping(bytes32 => bool) processedWithdrawals;
        uint256 depositNonce;
        uint256 challengePeriod; // 7 days

        // ═══════════════════════════════════════════════════════
        // SEQUENCER STORAGE
        // ═══════════════════════════════════════════════════════
        mapping(address => Sequencer) sequencers;
        address[] activeSequencers;
        uint256 currentRotation;
        uint256 blocksPerRotation; // 100 blocks
        uint256 stakeAmount; // 32 TEQ
        mapping(address => uint256) blockRewards;
        mapping(uint256 => Batch) batches;
        uint256 latestL2Block;

        // ═══════════════════════════════════════════════════════
        // STAKING STORAGE
        // ═══════════════════════════════════════════════════════
        mapping(address => mapping(address => Stake)) stakes; // staker => sequencer => stake info
        mapping(address => uint256) totalStakedToSequencer;
        mapping(address => uint256) pendingRewards;
        uint256 rewardPerBlock; // TEQ rewards per block
        uint256 lastRewardBlock;

        // ═══════════════════════════════════════════════════════
        // LIQUIDITY STORAGE
        // ═══════════════════════════════════════════════════════
        uint256 teqReserve;
        uint256 ethReserve;
        mapping(address => uint256) lpTokens;
        uint256 totalLPTokens;
        mapping(address => uint256) lpRewards;
        uint256 lpRewardPerBlock;
        uint256 lastLPRewardBlock;

        // ═══════════════════════════════════════════════════════
        // GLOBAL SETTINGS
        // ═══════════════════════════════════════════════════════
        address teqToken; // TEQ Token contract address
        bool paused; // Emergency pause

        // ═══════════════════════════════════════════════════════
        // V3 BRIDGE STORAGE - appended only, do not reorder above fields
        // ═══════════════════════════════════════════════════════
        mapping(uint256 => bytes32) batchWithdrawalRoots; // batchNumber => withdrawal Merkle root
        mapping(uint256 => bool) batchRootSet; // batchNumber => root explicitly committed
        uint256 latestBatchNumber; // latest submitted batch number
        mapping(bytes32 => uint256) withdrawalBatch; // withdrawalId => source batch number
        mapping(uint256 => bool) batchInvalidated; // batchNumber => invalidated by dispute game
        address disputeGameAddress; // optional dispute game authorized to invalidate batches
        uint256 reentrancyStatus; // 1 = not entered, 2 = entered

        // ═══════════════════════════════════════════════════════
        // FRAUD PROOF STORAGE - appended only, do not reorder above fields
        // ═══════════════════════════════════════════════════════
        mapping(uint256 => StateCommitmentData) stateCommitments; // batchNumber => full commitment
        address challengePeriodAddress; // optional dynamic challenge-period oracle

        // ═══════════════════════════════════════════════════════
        // DATA AVAILABILITY POLICY - appended only, do not reorder above fields
        // ═══════════════════════════════════════════════════════
        uint8 requiredDaMode; // 0=none allowed, 1=calldata or blob required, 2=blob required
        uint256 daActivationBatch; // first batch number where requiredDaMode is enforced
    }

    // ═══════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════

    struct Withdrawal {
        address token;
        address to;
        uint256 amount;
        uint256 timestamp;
        bool finalized;
        bool challenged;
        uint256 challengeExpiry;
    }

    struct Sequencer {
        address operator;
        uint256 stakedAmount;
        uint256 blocksProduced;
        uint256 lastActiveBlock;
        uint256 totalRewardsEarned;
        bool isActive;
        uint256 registeredAt;
    }

    struct Batch {
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        uint256 l2BlockNumber;
        uint256 l1BlockNumber;
        uint256 timestamp;
        address sequencer;
    }

    struct StateCommitmentData {
        uint256 l2StartBlock;
        uint256 l2EndBlock;
        bytes32 preStateRoot;
        bytes32 postStateRoot;
        bytes32 transactionsRoot;
        bytes32 withdrawalsRoot;
        uint256 timestamp;
        address sequencer;
        bool exists;
        uint8 daMode; // 0=none/legacy, 1=calldata, 2=blob
        bytes32 daCommitment; // calldata: keccak(batchData), blob: keccak(blobVersionedHashes)
        bytes32 daDataHash; // keccak256 canonical batch bytes
        uint256 daByteSize; // canonical batch byte length
    }

    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastClaimBlock;
        bool active;
    }

    // ═══════════════════════════════════════════════════════
    // STORAGE ACCESS
    // ═══════════════════════════════════════════════════════

    function appStorage() internal pure returns (AppStorage storage s) {
        bytes32 position = APP_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
}
