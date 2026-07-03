// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "../diamond/libraries/LibAppStorage.sol";
import {LibDiamond} from "../diamond/libraries/LibDiamond.sol";

/**
 * @title SequencerFacetV3
 * @author TeQoin
 * @notice Manages sequencer rotation, batch submission with full state commitments.
 *
 * V3 changes:
 *   - submitBatch now stores full StateCommitment (pre/post roots, tx root, wd root)
 *   - Write-once protection: cannot overwrite a submitted batch
 *   - Monotonic batch numbering enforced
 *   - Stores submitting sequencer address per batch (for dispute attribution)
 */
contract SequencerFacetV3 {
    // ═══════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════

    /// @notice Full state commitment stored per batch
    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event BatchSubmitted(
        uint256 indexed batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        address indexed sequencer
    );

    event SequencerAdded(address indexed sequencer);
    event SequencerRemoved(address indexed sequencer);
    event StateCommitmentAnchored(uint256 indexed batchNumber, uint256 indexed l2EndBlock, bytes32 postStateRoot);

    // ═══════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════

    error OnlySequencer();
    error OnlyOwner();
    error BatchAlreadySubmitted();
    error BatchNumberNotMonotonic();
    error InvalidBlockRange();
    error ZeroStateRoot();
    error ZeroRoot();
    error ZeroAddress();
    error BatchNumberNotSequential();
    error BlockRangeNotContinuous();
    error StateRootNotChained();

    // ═══════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════

    modifier onlySequencer() {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (!s.sequencers[msg.sender].isActive) revert OnlySequencer();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != LibDiamond.contractOwner()) revert OnlyOwner();
        _;
    }

    // ═══════════════════════════════════════════════════════
    // BATCH SUBMISSION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Submit a batch with full state commitment.
     *         Write-once: cannot overwrite. Monotonic: must increment.
     *
     * @param _batchNumber       Sequential batch identifier
     * @param _l2StartBlock      First L2 block in this batch
     * @param _l2EndBlock        Last L2 block in this batch
     * @param _preStateRoot      World state root BEFORE executing batch transactions
     * @param _postStateRoot     World state root AFTER executing batch transactions
     * @param _transactionsRoot  Merkle root of all transaction hashes in batch
     * @param _withdrawalsRoot   Merkle root of all withdrawal leaves in batch
     */
    function submitBatch(
        uint256 _batchNumber,
        uint256 _l2StartBlock,
        uint256 _l2EndBlock,
        bytes32 _preStateRoot,
        bytes32 _postStateRoot,
        bytes32 _transactionsRoot,
        bytes32 _withdrawalsRoot
    ) external onlySequencer {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        // Write-once: prevent overwriting existing batch
        if (s.stateCommitments[_batchNumber].exists) revert BatchAlreadySubmitted();

        // Block range must be valid
        if (_l2StartBlock > _l2EndBlock) revert InvalidBlockRange();

        // Core roots must be non-zero.
        if (_preStateRoot == bytes32(0)) revert ZeroStateRoot();
        if (_postStateRoot == bytes32(0)) revert ZeroStateRoot();
        if (_transactionsRoot == bytes32(0)) revert ZeroRoot();
        if (_withdrawalsRoot == bytes32(0)) revert ZeroRoot();

        // Exact continuity: no gaps, no skips, no duplicate batches.
        if (_batchNumber != s.latestBatchNumber + 1) revert BatchNumberNotSequential();
        if (_l2StartBlock != s.latestL2Block + 1) revert BlockRangeNotContinuous();

        // State-root chaining: once an anchor/previous batch exists, the new
        // pre-state must exactly equal the prior post-state.
        if (s.stateCommitments[_batchNumber - 1].exists) {
            if (_preStateRoot != s.stateCommitments[_batchNumber - 1].postStateRoot) {
                revert StateRootNotChained();
            }
        }

        // Store full commitment
        s.stateCommitments[_batchNumber] = LibAppStorage.StateCommitmentData({
            l2StartBlock: _l2StartBlock,
            l2EndBlock: _l2EndBlock,
            preStateRoot: _preStateRoot,
            postStateRoot: _postStateRoot,
            transactionsRoot: _transactionsRoot,
            withdrawalsRoot: _withdrawalsRoot,
            timestamp: block.timestamp,
            sequencer: msg.sender,
            exists: true,
            daMode: 0,
            daCommitment: bytes32(0),
            daDataHash: bytes32(0),
            daByteSize: 0
        });

        // Store withdrawal root for BridgeFacetV3 proof verification
        s.batchWithdrawalRoots[_batchNumber] = _withdrawalsRoot;
        s.latestBatchNumber = _batchNumber;
        s.latestL2Block = _l2EndBlock;

        emit BatchSubmitted(
            _batchNumber,
            _l2StartBlock,
            _l2EndBlock,
            _preStateRoot,
            _postStateRoot,
            _transactionsRoot,
            _withdrawalsRoot,
            msg.sender
        );
    }

    /**
     * @notice One-time migration helper to anchor the fraud-proof state chain
     *         at the already-submitted production batch cursor.
     * @dev Must be called before the first fraud-proof batch if historical
     *      batches were submitted without pre/post-state commitments.
     */
    function anchorStateCommitment(uint256 _batchNumber, uint256 _l2EndBlock, bytes32 _postStateRoot)
        external
        onlyOwner
    {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (_postStateRoot == bytes32(0)) revert ZeroStateRoot();
        if (s.stateCommitments[_batchNumber].exists) revert BatchAlreadySubmitted();
        if (_batchNumber != s.latestBatchNumber) revert BatchNumberNotMonotonic();
        if (_l2EndBlock != s.latestL2Block) revert BlockRangeNotContinuous();

        s.stateCommitments[_batchNumber] = LibAppStorage.StateCommitmentData({
            l2StartBlock: _l2EndBlock,
            l2EndBlock: _l2EndBlock,
            preStateRoot: _postStateRoot,
            postStateRoot: _postStateRoot,
            transactionsRoot: _postStateRoot,
            withdrawalsRoot: s.batchWithdrawalRoots[_batchNumber],
            timestamp: block.timestamp,
            sequencer: msg.sender,
            exists: true,
            daMode: 0,
            daCommitment: bytes32(0),
            daDataHash: bytes32(0),
            daByteSize: 0
        });

        emit StateCommitmentAnchored(_batchNumber, _l2EndBlock, _postStateRoot);
    }

    // ═══════════════════════════════════════════════════════
    // SEQUENCER MANAGEMENT
    // ═══════════════════════════════════════════════════════

    function addSequencer(address _sequencer) external onlyOwner {
        if (_sequencer == address(0)) revert ZeroAddress();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        s.sequencers[_sequencer].operator = _sequencer;
        s.sequencers[_sequencer].isActive = true;
        emit SequencerAdded(_sequencer);
    }

    function removeSequencer(address _sequencer) external onlyOwner {
        LibAppStorage.appStorage().sequencers[_sequencer].isActive = false;
        emit SequencerRemoved(_sequencer);
    }

    // ═══════════════════════════════════════════════════════
    // VIEWS
    // ═══════════════════════════════════════════════════════

    function getStateCommitment(uint256 _batchNumber)
        external
        view
        returns (
            uint256 l2StartBlock,
            uint256 l2EndBlock,
            bytes32 preStateRoot,
            bytes32 postStateRoot,
            bytes32 transactionsRoot,
            bytes32 withdrawalsRoot,
            uint256 timestamp,
            address sequencer,
            bool exists
        )
    {
        LibAppStorage.StateCommitmentData memory c = LibAppStorage.appStorage().stateCommitments[_batchNumber];
        return (
            c.l2StartBlock,
            c.l2EndBlock,
            c.preStateRoot,
            c.postStateRoot,
            c.transactionsRoot,
            c.withdrawalsRoot,
            c.timestamp,
            c.sequencer,
            c.exists
        );
    }

    function getLatestBatchNumber() external view returns (uint256) {
        return LibAppStorage.appStorage().latestBatchNumber;
    }

    function getLatestL2Block() external view returns (uint256) {
        return LibAppStorage.appStorage().latestL2Block;
    }

    function isSequencer(address _addr) external view returns (bool) {
        return LibAppStorage.appStorage().sequencers[_addr].isActive;
    }
}
