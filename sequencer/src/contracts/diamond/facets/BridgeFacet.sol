// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title BridgeFacet
 * @notice Handles deposits to L2 and withdrawals from L2
 * @dev Runs on L1 (Sepolia)
 */
contract BridgeFacet is ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════
    
    event Deposited(
        bytes32 indexed depositId,
        address indexed token,
        address indexed from,
        address to,
        uint256 amount,
        uint256 nonce
    );
    
    event WithdrawalQueued(
        bytes32 indexed withdrawalId,
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 timestamp
    );
    
    event WithdrawalFinalized(
        bytes32 indexed withdrawalId,
        address indexed to,
        uint256 amount
    );
    
    event WithdrawalChallenged(
        bytes32 indexed withdrawalId,
        address indexed challenger
    );
    
    // ═══════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════
    
    modifier onlySequencer() {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        bool isSequencer = false;
        for (uint i = 0; i < s.activeSequencers.length; i++) {
            if (s.activeSequencers[i] == msg.sender) {
                isSequencer = true;
                break;
            }
        }
        require(isSequencer, "BridgeFacet: Not a sequencer");
        _;
    }
    
    modifier whenNotPaused() {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        require(!s.paused, "BridgeFacet: System paused");
        _;
    }
    
    // ═══════════════════════════════════════════════════════
    // DEPOSIT FUNCTIONS (L1 → L2)
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Deposit ETH to L2
     * @param to Recipient address on L2
     */
    function depositETH(address to) external payable whenNotPaused {
        require(msg.value > 0, "BridgeFacet: Must deposit ETH");
        require(to != address(0), "BridgeFacet: Invalid recipient");
        
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        
        uint256 nonce = s.depositNonce++;
        bytes32 depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                to,
                msg.value,
                nonce,
                block.timestamp
            )
        );
        
        emit Deposited(
            depositId,
            address(0), // ETH
            msg.sender,
            to,
            msg.value,
            nonce
        );
    }
    
    /**
     * @notice Deposit ERC20 tokens to L2
     * @param token Token address
     * @param to Recipient on L2
     * @param amount Amount to deposit
     */
    function depositERC20(
        address token,
        address to,
        uint256 amount
    ) external whenNotPaused {
        require(token != address(0), "BridgeFacet: Invalid token");
        require(to != address(0), "BridgeFacet: Invalid recipient");
        require(amount > 0, "BridgeFacet: Invalid amount");
        
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        
        // Transfer tokens from user to bridge
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        
        uint256 nonce = s.depositNonce++;
        bytes32 depositId = keccak256(
            abi.encodePacked(
                token,
                msg.sender,
                to,
                amount,
                nonce,
                block.timestamp
            )
        );
        
        emit Deposited(
            depositId,
            token,
            msg.sender,
            to,
            amount,
            nonce
        );
    }
    
    // ═══════════════════════════════════════════════════════
    // WITHDRAWAL FUNCTIONS (L2 → L1)
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Queue a withdrawal from L2 (called by sequencer)
     * @param withdrawalId Unique withdrawal ID from L2
     * @param token Token address (address(0) for ETH)
     * @param to Recipient on L1
     * @param amount Amount to withdraw
     * @param proof Merkle proof of withdrawal on L2
     */
    function queueWithdrawal(
        bytes32 withdrawalId,
        address token,
        address to,
        uint256 amount,
        bytes memory proof
    ) external onlySequencer whenNotPaused {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        
        require(s.withdrawals[withdrawalId].timestamp == 0, "BridgeFacet: Already queued");
        require(to != address(0), "BridgeFacet: Invalid recipient");
        require(amount > 0, "BridgeFacet: Invalid amount");
        require(s.latestL2Block > 0, "BridgeFacet: No batches submitted yet");
        
        // Get latest batch state root
        bytes32 stateRoot = s.batches[s.latestL2Block].stateRoot;
        require(stateRoot != bytes32(0), "BridgeFacet: Invalid state root");
        
        // Create leaf hash (withdrawal data)
        bytes32 leaf = keccak256(abi.encodePacked(withdrawalId, token, to, amount));
        
        // Decode proof from bytes to bytes32[]
        bytes32[] memory proofArray = abi.decode(proof, (bytes32[]));
        
        // Verify Merkle proof
        require(
            MerkleProof.verify(proofArray, stateRoot, leaf),
            "BridgeFacet: Invalid Merkle proof"
        );
        
        s.withdrawals[withdrawalId] = LibAppStorage.Withdrawal({
            token: token,
            to: to,
            amount: amount,
            timestamp: block.timestamp,
            finalized: false,
            challenged: false
        });
        
        emit WithdrawalQueued(withdrawalId, token, to, amount, block.timestamp);
    }
    
    /**
     * @notice Finalize a withdrawal after challenge period
     * @param withdrawalId The withdrawal to finalize
     */
    function finalizeWithdrawal(bytes32 withdrawalId) external nonReentrant whenNotPaused {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Withdrawal storage withdrawal = s.withdrawals[withdrawalId];
        
        require(withdrawal.timestamp > 0, "BridgeFacet: Withdrawal not found");
        require(!withdrawal.finalized, "BridgeFacet: Already finalized");
        require(!withdrawal.challenged, "BridgeFacet: Withdrawal challenged");
        require(
            block.timestamp >= withdrawal.timestamp + s.challengePeriod,
            "BridgeFacet: Challenge period not over"
        );
        require(!s.processedWithdrawals[withdrawalId], "BridgeFacet: Already processed");
        
        withdrawal.finalized = true;
        s.processedWithdrawals[withdrawalId] = true;
        
        // Transfer tokens
        if (withdrawal.token == address(0)) {
            // ETH
            (bool success, ) = withdrawal.to.call{value: withdrawal.amount}("");
            require(success, "BridgeFacet: ETH transfer failed");
        } else {
            // ERC20
            IERC20(withdrawal.token).transfer(withdrawal.to, withdrawal.amount);
        }
        
        emit WithdrawalFinalized(withdrawalId, withdrawal.to, withdrawal.amount);
    }
    
    /**
     * @notice Challenge a fraudulent withdrawal
     * @param withdrawalId The withdrawal to challenge
     * @param proof Fraud proof data
     */
    function challengeWithdrawal(
        bytes32 withdrawalId,
        bytes memory proof
    ) external whenNotPaused {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Withdrawal storage withdrawal = s.withdrawals[withdrawalId];
        
        require(withdrawal.timestamp > 0, "BridgeFacet: Withdrawal not found");
        require(!withdrawal.finalized, "BridgeFacet: Already finalized");
        require(!withdrawal.challenged, "BridgeFacet: Already challenged");
        require(
            block.timestamp < withdrawal.timestamp + s.challengePeriod,
            "BridgeFacet: Challenge period over"
        );
        
        // Verify fraud proof
        // The proof should demonstrate that the withdrawal is NOT in the L2 state
        // For MVP: We accept the challenge if proof is non-empty
        // Production: Implement full fraud proof verification
        require(proof.length > 0, "BridgeFacet: Empty fraud proof");
        
        // Mark as challenged (prevents finalization)
        withdrawal.challenged = true;
        
        emit WithdrawalChallenged(withdrawalId, msg.sender);
        
        // TODO: Slash the sequencer who submitted invalid withdrawal
    }
    
    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Get withdrawal details
     * @param withdrawalId The withdrawal to query
     */
    function getWithdrawal(bytes32 withdrawalId)
        external
        view
        returns (
            address token,
            address to,
            uint256 amount,
            uint256 timestamp,
            bool finalized,
            bool challenged
        )
    {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Withdrawal memory w = s.withdrawals[withdrawalId];
        return (w.token, w.to, w.amount, w.timestamp, w.finalized, w.challenged);
    }
    
    /**
     * @notice Check if withdrawal has been processed
     * @param withdrawalId The withdrawal to check
     */
    function isWithdrawalProcessed(bytes32 withdrawalId) external view returns (bool) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.processedWithdrawals[withdrawalId];
    }
    
    /**
     * @notice Get challenge period duration
     */
    function getChallengePeriod() external view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.challengePeriod;
    }
    
    // ═══════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Set challenge period (only owner)
     * @param period New challenge period in seconds
     */
    function setChallengePeriod(uint256 period) external {
        LibDiamond.enforceIsContractOwner();
        require(period >= 1 days && period <= 30 days, "BridgeFacet: Invalid period");
        
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.challengePeriod = period;
    }
    
    /**
     * @notice Pause the bridge (emergency)
     */
    function pause() external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.paused = true;
    }
    
    /**
     * @notice Unpause the bridge
     */
    function unpause() external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.paused = false;
    }
    
    // Receive ETH
    receive() external payable {}
}