// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FaultProofVM (Simplified)
 * @author TeQoin
 * @notice Verifies a single execution step to resolve disputes.
 *
 * This is the SIMPLIFIED verifier for testnet/initial mainnet.
 * It verifies specific state transition types without full EVM execution:
 *   - ETH transfers (balance changes)
 *   - ERC-20 transfers (balance + totalSupply changes)
 *   - Bridge operations (mint/burn matching deposit/withdrawal)
 *
 * For full mainnet security, upgrade to Cannon (MIPS) or RISC-V VM
 * that can execute arbitrary EVM instructions on L1.
 *
 * Upgrade path:
 *   Phase 1 (now):  Simplified verifier — covers 90% of bridge operations
 *   Phase 2 (later): Cannon-style VM — covers 100% of EVM execution
 */
contract FaultProofVM {

    // ═══════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════

    /// @notice Types of state transitions we can verify
    enum TransitionType {
        ETH_TRANSFER,       // Simple ETH send
        ERC20_TRANSFER,     // ERC-20 token transfer
        ERC20_MINT,         // Bridge deposit — mint wrapped token
        ERC20_BURN,         // Bridge withdrawal — burn wrapped token
        STORAGE_WRITE       // Generic storage slot write
    }

    /// @notice A single account state snapshot
    struct AccountState {
        address account;
        uint256 ethBalance;
        uint256 nonce;
    }

    /// @notice A single storage slot snapshot
    struct StorageSlot {
        address account;
        bytes32 slot;
        bytes32 value;
    }

    /// @notice A state transition claim to verify
    struct TransitionClaim {
        TransitionType transitionType;
        // Pre-state
        AccountState[] preAccounts;
        StorageSlot[] preStorage;
        // Post-state
        AccountState[] postAccounts;
        StorageSlot[] postStorage;
        // Transaction data
        address from;
        address to;
        uint256 value;
        bytes data;
    }

    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event StepVerified(
        bytes32 indexed preStateHash,
        bytes32 indexed postStateHash,
        bool valid,
        string reason
    );

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error InvalidTransitionType();
    error InsufficientPreState();
    error InsufficientPostState();
    error StateHashMismatch();
    error InputTooLarge();
    error ZeroAddress();

    // ═══════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════

    address public owner;
    address public disputeGame;
    uint256 public constant MAX_ACCOUNTS = 16;
    uint256 public constant MAX_STORAGE_SLOTS = 32;
    uint256 public constant MAX_DATA_BYTES = 4096;

    modifier onlyDisputeGame() {
        require(msg.sender == disputeGame || msg.sender == owner, "Only DisputeGame");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setDisputeGame(address _dg) external {
        require(msg.sender == owner, "Only owner");
        if (_dg == address(0)) revert ZeroAddress();
        disputeGame = _dg;
    }

    // ═══════════════════════════════════════════════════════
    // MAIN VERIFICATION FUNCTION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Verify a single execution step.
     *         Called by DisputeGame.resolveDispute() at the end of bisection.
     *
     * @param _preStateHash   Hash of the world state before this step
     * @param _postStateHash  Hash the sequencer claims is the state after this step
     * @param _claim          The state transition claim with pre/post snapshots
     * @return valid           True if the claimed post-state is correct
     * @return reason          Human-readable explanation if invalid
     */
    function verifyStep(
        bytes32 _preStateHash,
        bytes32 _postStateHash,
        TransitionClaim calldata _claim
    ) external onlyDisputeGame returns (bool valid, string memory reason) {
        if (
            _claim.preAccounts.length > MAX_ACCOUNTS ||
            _claim.postAccounts.length > MAX_ACCOUNTS ||
            _claim.preStorage.length > MAX_STORAGE_SLOTS ||
            _claim.postStorage.length > MAX_STORAGE_SLOTS ||
            _claim.data.length > MAX_DATA_BYTES
        ) revert InputTooLarge();

        // Verify pre-state hash matches the snapshots
        bytes32 computedPreHash = _hashAccountStates(_claim.preAccounts, _claim.preStorage);
        if (computedPreHash != _preStateHash) revert StateHashMismatch();

        // Verify the transition based on type
        if (_claim.transitionType == TransitionType.ETH_TRANSFER) {
            (valid, reason) = _verifyEthTransfer(_claim);
        } else if (_claim.transitionType == TransitionType.ERC20_TRANSFER) {
            (valid, reason) = _verifyErc20Transfer(_claim);
        } else if (_claim.transitionType == TransitionType.ERC20_MINT) {
            (valid, reason) = _verifyErc20Mint(_claim);
        } else if (_claim.transitionType == TransitionType.ERC20_BURN) {
            (valid, reason) = _verifyErc20Burn(_claim);
        } else if (_claim.transitionType == TransitionType.STORAGE_WRITE) {
            (valid, reason) = _verifyStorageWrite(_claim);
        } else {
            revert InvalidTransitionType();
        }

        // If the transition is valid, check that the post-state hash matches
        if (valid) {
            bytes32 computedPostHash = _hashAccountStates(_claim.postAccounts, _claim.postStorage);
            if (computedPostHash != _postStateHash) {
                valid = false;
                reason = "Post-state hash mismatch";
            }
        }

        emit StepVerified(_preStateHash, _postStateHash, valid, reason);
    }

    // ═══════════════════════════════════════════════════════
    // TRANSITION VERIFIERS
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Verify ETH transfer: sender balance decreases, receiver increases
     */
    function _verifyEthTransfer(TransitionClaim calldata c)
        internal pure returns (bool, string memory)
    {
        if (c.preAccounts.length < 2 || c.postAccounts.length < 2) {
            return (false, "Need sender + receiver accounts");
        }

        // Find sender and receiver in pre and post states
        AccountState calldata preSender = c.preAccounts[0];
        AccountState calldata preReceiver = c.preAccounts[1];
        AccountState calldata postSender = c.postAccounts[0];
        AccountState calldata postReceiver = c.postAccounts[1];

        // Verify addresses match
        if (
            preSender.account != c.from ||
            preReceiver.account != c.to ||
            postSender.account != c.from ||
            postReceiver.account != c.to
        ) {
            return (false, "Account address mismatch");
        }

        // Sender balance must decrease by exactly value
        if (preSender.ethBalance < c.value) {
            return (false, "Insufficient sender balance");
        }
        if (postSender.ethBalance != preSender.ethBalance - c.value) {
            return (false, "Sender balance incorrect after transfer");
        }

        // Receiver balance must increase by exactly value
        if (postReceiver.ethBalance != preReceiver.ethBalance + c.value) {
            return (false, "Receiver balance incorrect after transfer");
        }

        // Sender nonce must increment
        if (postSender.nonce != preSender.nonce + 1) {
            return (false, "Sender nonce not incremented");
        }
        if (postReceiver.nonce != preReceiver.nonce) {
            return (false, "Receiver nonce changed");
        }

        return (true, "");
    }

    /**
     * @dev Verify ERC-20 transfer: storage slot changes for balances
     *      balanceOf[from] decreases, balanceOf[to] increases
     */
    function _verifyErc20Transfer(TransitionClaim calldata c)
        internal pure returns (bool, string memory)
    {
        if (c.preStorage.length < 2 || c.postStorage.length < 2) {
            return (false, "Need sender + receiver storage slots");
        }

        // Pre-state storage: [senderBalance, receiverBalance]
        // Post-state storage: [senderBalance, receiverBalance]
        uint256 preSenderBal = uint256(c.preStorage[0].value);
        uint256 preReceiverBal = uint256(c.preStorage[1].value);
        uint256 postSenderBal = uint256(c.postStorage[0].value);
        uint256 postReceiverBal = uint256(c.postStorage[1].value);

        if (
            c.preStorage[0].account != c.to ||
            c.preStorage[1].account != c.to ||
            c.postStorage[0].account != c.to ||
            c.postStorage[1].account != c.to ||
            c.preStorage[0].slot != c.postStorage[0].slot ||
            c.preStorage[1].slot != c.postStorage[1].slot
        ) {
            return (false, "ERC20 storage slot mismatch");
        }

        if (preSenderBal < c.value) {
            return (false, "Insufficient ERC20 balance");
        }
        if (postSenderBal != preSenderBal - c.value) {
            return (false, "Sender ERC20 balance incorrect");
        }
        if (postReceiverBal != preReceiverBal + c.value) {
            return (false, "Receiver ERC20 balance incorrect");
        }

        return (true, "");
    }

    /**
     * @dev Verify ERC-20 mint (bridge deposit):
     *      totalSupply increases, recipient balance increases
     */
    function _verifyErc20Mint(TransitionClaim calldata c)
        internal pure returns (bool, string memory)
    {
        if (c.preStorage.length < 2 || c.postStorage.length < 2) {
            return (false, "Need totalSupply + recipient slots");
        }

        // Storage[0] = totalSupply, Storage[1] = recipientBalance
        uint256 preTotalSupply = uint256(c.preStorage[0].value);
        uint256 preRecipientBal = uint256(c.preStorage[1].value);
        uint256 postTotalSupply = uint256(c.postStorage[0].value);
        uint256 postRecipientBal = uint256(c.postStorage[1].value);

        if (
            c.preStorage[0].account != c.to ||
            c.preStorage[1].account != c.to ||
            c.postStorage[0].account != c.to ||
            c.postStorage[1].account != c.to ||
            c.preStorage[0].slot != c.postStorage[0].slot ||
            c.preStorage[1].slot != c.postStorage[1].slot
        ) {
            return (false, "Mint storage slot mismatch");
        }

        // TotalSupply must increase by mint amount
        if (postTotalSupply != preTotalSupply + c.value) {
            return (false, "TotalSupply not increased by mint amount");
        }

        // Recipient balance must increase by mint amount
        if (postRecipientBal != preRecipientBal + c.value) {
            return (false, "Recipient balance not increased by mint amount");
        }

        return (true, "");
    }

    /**
     * @dev Verify ERC-20 burn (bridge withdrawal):
     *      totalSupply decreases, sender balance decreases
     */
    function _verifyErc20Burn(TransitionClaim calldata c)
        internal pure returns (bool, string memory)
    {
        if (c.preStorage.length < 2 || c.postStorage.length < 2) {
            return (false, "Need totalSupply + sender slots");
        }

        uint256 preTotalSupply = uint256(c.preStorage[0].value);
        uint256 preSenderBal = uint256(c.preStorage[1].value);
        uint256 postTotalSupply = uint256(c.postStorage[0].value);
        uint256 postSenderBal = uint256(c.postStorage[1].value);

        if (
            c.preStorage[0].account != c.to ||
            c.preStorage[1].account != c.to ||
            c.postStorage[0].account != c.to ||
            c.postStorage[1].account != c.to ||
            c.preStorage[0].slot != c.postStorage[0].slot ||
            c.preStorage[1].slot != c.postStorage[1].slot
        ) {
            return (false, "Burn storage slot mismatch");
        }

        if (preSenderBal < c.value) {
            return (false, "Insufficient balance to burn");
        }
        if (postTotalSupply != preTotalSupply - c.value) {
            return (false, "TotalSupply not decreased by burn amount");
        }
        if (postSenderBal != preSenderBal - c.value) {
            return (false, "Sender balance not decreased by burn amount");
        }

        return (true, "");
    }

    /**
     * @dev Verify generic storage write
     */
    function _verifyStorageWrite(TransitionClaim calldata c)
        internal pure returns (bool, string memory)
    {
        if (c.preStorage.length < 1 || c.postStorage.length < 1) {
            return (false, "Need at least one storage slot");
        }

        // Verify storage slot address and key match
        if (c.preStorage[0].account != c.postStorage[0].account) {
            return (false, "Storage account mismatch");
        }
        if (c.preStorage[0].slot != c.postStorage[0].slot) {
            return (false, "Storage slot key mismatch");
        }

        return (false, "Generic storage writes require real VM proof");
    }

    // ═══════════════════════════════════════════════════════
    // HASHING
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Hash account states + storage into a single commitment.
     *      This is the simplified version — full version would compute
     *      the actual Merkle Patricia Trie root.
     */
    function _hashAccountStates(
        AccountState[] calldata _accounts,
        StorageSlot[] calldata _storage
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(_accounts, _storage));
    }
}
