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