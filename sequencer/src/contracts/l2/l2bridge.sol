// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title L2Bridge
 * @notice Handles deposits from L1 and initiates withdrawals to L1
 * @dev This contract runs on the L2 network
 */
contract L2Bridge is Ownable, ReentrancyGuard {
    // Sequencer address that can process L1 deposits
    address public sequencer;
    
    // Withdrawal nonce for unique withdrawal IDs
    uint256 public withdrawalNonce;
    
    // Mapping of processed L1 deposits to prevent replay
    mapping(bytes32 => bool) public processedDeposits;
    
    // Mapping of pending withdrawals
    mapping(bytes32 => Withdrawal) public withdrawals;
    
    struct Withdrawal {
        address token;
        address from;
        address to;
        uint256 amount;
        uint256 timestamp;
        bool processed;
    }
    
    // Events
    event DepositProcessed(
        bytes32 indexed depositId,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    
    event WithdrawalInitiated(
        bytes32 indexed withdrawalId,
        address indexed token,
        address indexed from,
        address to,
        uint256 amount,
        uint256 nonce
    );
    
    event WithdrawalCancelled(
        bytes32 indexed withdrawalId,
        address indexed user,
        uint256 amount
    );
    
    event SequencerUpdated(
        address indexed oldSequencer,
        address indexed newSequencer
    );
    
    constructor(address _sequencer) Ownable(msg.sender) {
        require(_sequencer != address(0), "Invalid sequencer");
        sequencer = _sequencer;
    }
    
    /**
     * @notice Process a deposit that originated from L1
     * @param token Token address (address(0) for ETH)
     * @param recipient Recipient on L2
     * @param amount Amount to credit
     * @param depositId Unique deposit ID from L1
     */
    function processDeposit(
        address token,
        address recipient,
        uint256 amount,
        bytes32 depositId
    ) external {
        require(msg.sender == sequencer, "Only sequencer");
        require(!processedDeposits[depositId], "Already processed");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        
        processedDeposits[depositId] = true;
        
        if (token == address(0)) {
            // Send ETH to recipient on L2
            (bool success, ) = payable(recipient).call{value: amount}("");
            require(success, "L2Bridge: ETH transfer failed");
        }
        // For ERC20 tokens, we'd mint wrapped tokens here
        
        emit DepositProcessed(depositId, token, recipient, amount);
    }
    
    /**
     * @notice Initiate withdrawal from L2 to L1
     * @param token Token address (address(0) for ETH)
     * @param to Recipient address on L1
     * @param amount Amount to withdraw
     * @return withdrawalId Unique withdrawal ID
     */
    function initiateWithdrawal(
        address token,
        address to,
        uint256 amount
    ) external payable nonReentrant returns (bytes32) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        
        if (token == address(0)) {
            require(msg.value == amount, "Incorrect ETH amount");
        }
        // For ERC20 tokens, we'd burn wrapped tokens here
        
        uint256 nonce = withdrawalNonce++;
        bytes32 withdrawalId = keccak256(
            abi.encodePacked(token, msg.sender, to, amount, nonce, block.timestamp)
        );
        
        withdrawals[withdrawalId] = Withdrawal({
            token: token,
            from: msg.sender,
            to: to,
            amount: amount,
            timestamp: block.timestamp,
            processed: false
        });
        
        emit WithdrawalInitiated(withdrawalId, token, msg.sender, to, amount, nonce);
        
        return withdrawalId;
    }
    
    /**
     * @notice Cancel a pending withdrawal (before it's included in batch)
     * @param withdrawalId The withdrawal to cancel
     */
    function cancelWithdrawal(bytes32 withdrawalId) external nonReentrant {
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        
        require(withdrawal.from != address(0), "Withdrawal not found");
        require(withdrawal.from == msg.sender, "Not withdrawal owner");
        require(!withdrawal.processed, "Already processed");
        require(
            block.timestamp < withdrawal.timestamp + 1 hours,
            "Cancellation period expired"
        );
        
        uint256 amount = withdrawal.amount;
        address token = withdrawal.token;
        
        // Mark as processed to prevent re-entry
        withdrawal.processed = true;
        
        // Refund
        if (token == address(0)) {
            (bool success, ) = payable(msg.sender).call{value: amount}("");
            require(success, "L2Bridge: ETH refund failed");
        }
        // For ERC20, we'd transfer back wrapped tokens
        
        emit WithdrawalCancelled(withdrawalId, msg.sender, amount);
    }
    
    /**
     * @notice Mark withdrawal as processed by sequencer
     * @param withdrawalId The withdrawal to mark
     */
    function markWithdrawalProcessed(bytes32 withdrawalId) external {
        require(msg.sender == sequencer, "Only sequencer");
        
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        require(withdrawal.from != address(0), "Withdrawal not found");
        require(!withdrawal.processed, "Already processed");
        
        withdrawal.processed = true;
    }
    
    /**
     * @notice Update sequencer address
     * @param newSequencer New sequencer address
     */
    function updateSequencer(address newSequencer) external onlyOwner {
        require(newSequencer != address(0), "Invalid sequencer");
        address oldSequencer = sequencer;
        sequencer = newSequencer;
        emit SequencerUpdated(oldSequencer, newSequencer);
    }
    
    /**
     * @notice Get withdrawal details
     * @param withdrawalId The withdrawal to query
     */
    function getWithdrawal(bytes32 withdrawalId) 
        external 
        view 
        returns (
            address token,
            address from,
            address to,
            uint256 amount,
            uint256 timestamp,
            bool processed
        ) 
    {
        Withdrawal memory w = withdrawals[withdrawalId];
        return (w.token, w.from, w.to, w.amount, w.timestamp, w.processed);
    }
    
    /**
     * @notice Check if deposit has been processed
     * @param depositId The deposit to check
     */
    function isDepositProcessed(bytes32 depositId) external view returns (bool) {
        return processedDeposits[depositId];
    }
    
    // Receive ETH for deposits
    receive() external payable {}
}