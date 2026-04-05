// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ETHStaking
 * @notice Users stake ETH on L2 and earn TEQ token rewards
 * @dev Runs on L2 (Chain ID: 420337)
 * 
 * Features:
 * - Stake ETH, earn TEQ rewards
 * - Flexible APY (adjustable by owner)
 * - Instant unstaking (no lock period for MVP)
 * - Rewards calculated per block
 */
contract ETHStaking is Ownable, ReentrancyGuard {
    
    // TEQ token contract
    IERC20 public teqToken;
    
    // Staking parameters
    uint256 public annualRewardRate = 50; // 50% APY (5000 basis points)
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant BLOCKS_PER_YEAR = 6307200; // ~5 sec per block
    
    // Total staked ETH
    uint256 public totalStaked;
    
    // User stakes
    struct Stake {
        uint256 amount;           // ETH staked
        uint256 stakedAt;         // Block number when staked
        uint256 lastClaimBlock;   // Last block rewards were claimed
        uint256 totalRewarded;    // Total TEQ earned (all time)
    }
    
    mapping(address => Stake) public stakes;
    
    // Total TEQ distributed
    uint256 public totalRewardsDistributed;
    
    // Events
    event Staked(address indexed user, uint256 amount, uint256 blockNumber);
    event Unstaked(address indexed user, uint256 amount, uint256 blockNumber);
    event RewardsClaimed(address indexed user, uint256 teqAmount, uint256 blockNumber);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    
    /**
     * @notice Constructor
     * @param _teqToken TEQ token address
     */
    constructor(address _teqToken) Ownable(msg.sender) {
        require(_teqToken != address(0), "ETHStaking: Invalid TEQ token");
        teqToken = IERC20(_teqToken);
    }
    
    // ═══════════════════════════════════════════════════════
    // STAKING FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Stake ETH to earn TEQ rewards
     */
    function stake() external payable nonReentrant {
        require(msg.value > 0, "ETHStaking: Must stake ETH");
        
        Stake storage userStake = stakes[msg.sender];
        
        // Claim pending rewards before updating stake
        if (userStake.amount > 0) {
            _claimRewards(msg.sender);
        }
        
        // Update stake
        if (userStake.amount == 0) {
            // New stake
            userStake.stakedAt = block.number;
            userStake.lastClaimBlock = block.number;
        }
        
        userStake.amount += msg.value;
        totalStaked += msg.value;
        
        emit Staked(msg.sender, msg.value, block.number);
    }
    
    /**
     * @notice Unstake ETH (claim rewards first)
     * @param amount Amount of ETH to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        Stake storage userStake = stakes[msg.sender];
        require(userStake.amount >= amount, "ETHStaking: Insufficient stake");
        require(amount > 0, "ETHStaking: Invalid amount");
        
        // Claim rewards first
        _claimRewards(msg.sender);
        
        // Update stake
        userStake.amount -= amount;
        totalStaked -= amount;
        
        // If fully unstaking, reset stake
        if (userStake.amount == 0) {
            delete stakes[msg.sender];
        }
        
        // Transfer ETH back to user
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETHStaking: ETH transfer failed");
        
        emit Unstaked(msg.sender, amount, block.number);
    }
    
    /**
     * @notice Unstake all ETH
     */
    function unstakeAll() external {
        Stake storage userStake = stakes[msg.sender];
        uint256 amount = userStake.amount;
        require(amount > 0, "ETHStaking: No stake");
        
        this.unstake(amount);
    }
    
    // ═══════════════════════════════════════════════════════
    // REWARDS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Claim accumulated TEQ rewards
     */
    function claimRewards() external nonReentrant {
        _claimRewards(msg.sender);
    }
    
    /**
     * @notice Internal function to claim rewards
     */
    function _claimRewards(address user) internal {
        Stake storage userStake = stakes[user];
        require(userStake.amount > 0, "ETHStaking: No stake");
        
        uint256 rewards = calculateRewards(user);
        
        if (rewards > 0) {
            userStake.lastClaimBlock = block.number;
            userStake.totalRewarded += rewards;
            totalRewardsDistributed += rewards;
            
            // Transfer TEQ rewards
            require(
                teqToken.transfer(user, rewards),
                "ETHStaking: TEQ transfer failed"
            );
            
            emit RewardsClaimed(user, rewards, block.number);
        }
    }
    
    /**
     * @notice Calculate pending TEQ rewards for a user
     * @param user User address
     * @return Pending TEQ rewards
     */
    function calculateRewards(address user) public view returns (uint256) {
        Stake memory userStake = stakes[user];
        
        if (userStake.amount == 0) {
            return 0;
        }
        
        // Calculate blocks since last claim
        uint256 blocksSinceLastClaim = block.number - userStake.lastClaimBlock;
        
        if (blocksSinceLastClaim == 0) {
            return 0;
        }
        
        // Calculate rewards
        // Formula: (stakedAmount × APY × blocks) / (BLOCKS_PER_YEAR × BASIS_POINTS)
        uint256 rewards = (userStake.amount * annualRewardRate * blocksSinceLastClaim) 
                          / (BLOCKS_PER_YEAR * BASIS_POINTS);
        
        return rewards;
    }
    
    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Get user's stake info
     * @param user User address
     */
    function getStakeInfo(address user) 
        external 
        view 
        returns (
            uint256 amount,
            uint256 stakedAt,
            uint256 lastClaimBlock,
            uint256 totalRewarded,
            uint256 pendingRewards
        ) 
    {
        Stake memory userStake = stakes[user];
        return (
            userStake.amount,
            userStake.stakedAt,
            userStake.lastClaimBlock,
            userStake.totalRewarded,
            calculateRewards(user)
        );
    }
    
    /**
     * @notice Get total staked ETH
     */
    function getTotalStaked() external view returns (uint256) {
        return totalStaked;
    }
    
    /**
     * @notice Get current APY
     */
    function getAPY() external view returns (uint256) {
        return annualRewardRate; // Returns basis points (50 = 0.5%)
    }
    
    /**
     * @notice Get total rewards distributed
     */
    function getTotalRewardsDistributed() external view returns (uint256) {
        return totalRewardsDistributed;
    }
    
    /**
     * @notice Estimate daily rewards for an amount
     * @param ethAmount ETH amount to stake
     * @return Estimated daily TEQ rewards
     */
    function estimateDailyRewards(uint256 ethAmount) external view returns (uint256) {
        uint256 blocksPerDay = 17280; // 86400 seconds / 5 seconds per block
        uint256 dailyRewards = (ethAmount * annualRewardRate * blocksPerDay) 
                               / (BLOCKS_PER_YEAR * BASIS_POINTS);
        return dailyRewards;
    }
    
    // ═══════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Update annual reward rate (APY)
     * @param newRate New rate in basis points (e.g., 5000 = 50%)
     */
    function setRewardRate(uint256 newRate) external onlyOwner {
        require(newRate <= 10000, "ETHStaking: Rate too high"); // Max 100%
        uint256 oldRate = annualRewardRate;
        annualRewardRate = newRate;
        emit RewardRateUpdated(oldRate, newRate);
    }
    
    /**
     * @notice Deposit TEQ tokens for rewards (owner only)
     * @param amount Amount of TEQ to deposit
     */
    function depositRewards(uint256 amount) external onlyOwner {
        require(
            teqToken.transferFrom(msg.sender, address(this), amount),
            "ETHStaking: TEQ transfer failed"
        );
    }
    
    /**
     * @notice Withdraw excess TEQ (emergency only)
     * @param amount Amount to withdraw
     */
    function withdrawTEQ(uint256 amount) external onlyOwner {
        require(
            teqToken.transfer(msg.sender, amount),
            "ETHStaking: TEQ transfer failed"
        );
    }
    
    /**
     * @notice Get contract TEQ balance
     */
    function getContractTEQBalance() external view returns (uint256) {
        return teqToken.balanceOf(address(this));
    }
    
    // Receive ETH
    receive() external payable {}
}