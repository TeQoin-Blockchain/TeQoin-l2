// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TEQToken (MVP Version)
 * @notice TEQ Token for L2 Rollup - Reward token for ETH staking
 * @dev MVP: Simple minting for staking rewards
 * 
 * Future (Q2 2025): Upgrade to governance token with full tokenomics
 * 
 * Total Supply: 10,000,000,000 TEQ (10 Billion)
 * MVP Focus: Staking rewards only
 */
contract TEQToken is ERC20, Ownable {
    // ═══════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════
    
    // Total supply: 10 billion tokens
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10**18;
    
    // Staking rewards allocation (MVP focus)
    uint256 public constant STAKING_REWARDS_ALLOCATION = 1_500_000_000 * 10**18; // 15%
    
    // ═══════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════
    
    // Track minted amounts
    uint256 public stakingRewardsMinted;
    uint256 public totalMinted;
    
    // Authorized minters (ETHStaking contract)
    mapping(address => bool) public isMinter;
    
    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════
    
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event StakingRewardsMinted(address indexed to, uint256 amount);
    
    // ═══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════
    
    constructor() ERC20("TeQoin", "TEQ") Ownable(msg.sender) {
        // MVP: No initial mint
        // All tokens minted via staking rewards
    }
    
    // ═══════════════════════════════════════════════════════
    // MINTER MANAGEMENT
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Add authorized minter (ETHStaking contract)
     * @param minter Address to authorize
     */
    function addMinter(address minter) external onlyOwner {
        require(minter != address(0), "TEQToken: Invalid minter");
        require(!isMinter[minter], "TEQToken: Already minter");
        
        isMinter[minter] = true;
        emit MinterAdded(minter);
    }
    
    /**
     * @notice Remove authorized minter
     * @param minter Address to remove
     */
    function removeMinter(address minter) external onlyOwner {
        require(isMinter[minter], "TEQToken: Not a minter");
        
        isMinter[minter] = false;
        emit MinterRemoved(minter);
    }
    
    // ═══════════════════════════════════════════════════════
    // MINTING (MVP: Staking Rewards Only)
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Mint staking rewards
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mintStakingReward(address to, uint256 amount) external {
        require(isMinter[msg.sender], "TEQToken: Not authorized");
        require(to != address(0), "TEQToken: Invalid recipient");
        require(amount > 0, "TEQToken: Invalid amount");
        
        // Check allocation limit
        require(
            stakingRewardsMinted + amount <= STAKING_REWARDS_ALLOCATION,
            "TEQToken: Exceeds staking allocation"
        );
        
        // Check max supply
        require(
            totalMinted + amount <= MAX_SUPPLY,
            "TEQToken: Exceeds max supply"
        );
        
        // Update tracking
        stakingRewardsMinted += amount;
        totalMinted += amount;
        
        // Mint tokens
        _mint(to, amount);
        
        emit StakingRewardsMinted(to, amount);
    }
    
    // ═══════════════════════════════════════════════════════
    // BURN (Deflationary)
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Burn tokens
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    /**
     * @notice Burn tokens from address (with allowance)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }
    
    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Get remaining staking allocation
     * @return Remaining tokens for staking rewards
     */
    function getRemainingStakingAllocation() external view returns (uint256) {
        return STAKING_REWARDS_ALLOCATION - stakingRewardsMinted;
    }
    
    /**
     * @notice Get total minted tokens
     * @return Total minted so far
     */
    function getTotalMinted() external view returns (uint256) {
        return totalMinted;
    }
    
    /**
     * @notice Check if address is authorized minter
     * @param account Address to check
     * @return True if authorized
     */
    function isMinterAuthorized(address account) external view returns (bool) {
        return isMinter[account];
    }
}