// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";

interface IChallengeStatsRecorder {
    function recordBatchSubmitted() external;
}

/**
 * @title SequencerFacet (Simplified for MVP)
 * @notice Batch submission and rotation logic - NO TOKEN DEPENDENCIES
 * @dev Runs on L1 (Sepolia)
 *
 * Architecture:
 * - Sequencers register on L2 via SequencerRegistry.sol
 * - Owner manually adds verified sequencers to L1 rotation
 * - Sequencers submit batches when it's their turn
 * - No staking, no rewards on L1 (happens on L2)
 *
 */
contract SequencerFacet {
    // ═══════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════

    event SequencerAdded(address indexed sequencer, uint256 timestamp);

    event SequencerRemoved(address indexed sequencer, uint256 timestamp);

    event BatchSubmitted(
        uint256 indexed l2BlockNumber,
        bytes32 indexed stateRoot,
        bytes32 transactionsRoot,
        address indexed sequencer,
        uint256 timestamp
    );

    event BatchSubmittedV3(
        uint256 indexed batchNumber,
        uint256 indexed l2BlockNumber,
        bytes32 stateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        address indexed sequencer,
        uint256 timestamp
    );

    event BatchStateCommitmentSubmitted(
        uint256 indexed batchNumber,
        uint256 l2StartBlock,
        uint256 indexed l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        address indexed sequencer,
        uint256 timestamp
    );

    event StateCommitmentAnchored(uint256 indexed batchNumber, uint256 indexed l2EndBlock, bytes32 postStateRoot);

    event BatchDataAvailabilityCommitted(
        uint256 indexed batchNumber,
        uint8 indexed daMode,
        bytes32 indexed daCommitment,
        bytes32 daDataHash,
        uint256 daByteSize
    );

    event RequiredDAModeUpdated(uint8 oldMode, uint8 newMode, uint256 oldActivationBatch, uint256 newActivationBatch);

    // ═══════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════

    uint256 constant BLOCKS_PER_ROTATION = 100;
    uint8 constant DA_MODE_NONE = 0;
    uint8 constant DA_MODE_CALLDATA = 1;
    uint8 constant DA_MODE_BLOB = 2;

    // ═══════════════════════════════════════════════════════
    // BATCH SUBMISSION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Submit a batch of L2 blocks to L1.
     * @dev Legacy 3-arg compatibility path. Uses stateRoot as withdrawalsRoot because
     *      the current production path historically committed the withdrawal root there.
     */
    function submitBatch(uint256 l2BlockNumber, bytes32 stateRoot, bytes32 transactionsRoot) external {
        _submitBatch(l2BlockNumber, stateRoot, transactionsRoot, stateRoot);
    }

    /**
     * @notice Submit a V3 batch with an explicit withdrawals root.
     * @param l2BlockNumber L2 block number (must be multiple of 100)
     * @param stateRoot State root / current structural commitment
     * @param transactionsRoot Transactions Merkle root
     * @param withdrawalsRoot Withdrawal Merkle root used by BridgeFacetV3 queueing
     */
    function submitBatch(uint256 l2BlockNumber, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 withdrawalsRoot)
        external
    {
        _submitBatch(l2BlockNumber, stateRoot, transactionsRoot, withdrawalsRoot);
    }

    /**
     * @notice Submit a fraud-proof-ready batch with exact state commitment.
     * @dev Enforces exact batch number, exact L2 block continuity, and state-root chaining.
     */
    function submitStateBatch(
        uint256 batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot
    ) external {
        _submitStateBatchWithDA(
            batchNumber,
            l2StartBlock,
            l2EndBlock,
            preStateRoot,
            postStateRoot,
            transactionsRoot,
            withdrawalsRoot,
            DA_MODE_NONE,
            bytes32(0),
            bytes32(0),
            0
        );
    }

    /**
     * @notice Submit a fraud-proof-ready batch and publish canonical batch bytes as L1 calldata DA.
     * @dev Verifiers can reconstruct the batch from this L1 transaction input and compare keccak(batchData)
     *      to the stored DA commitment/hash.
     */
    function submitStateBatchWithCalldata(
        uint256 batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        bytes calldata batchData
    ) external {
        require(batchData.length > 0, "SequencerFacet: Empty batch data");
        bytes32 dataHash = keccak256(batchData);
        _submitStateBatchWithDA(
            batchNumber,
            l2StartBlock,
            l2EndBlock,
            preStateRoot,
            postStateRoot,
            transactionsRoot,
            withdrawalsRoot,
            DA_MODE_CALLDATA,
            dataHash,
            dataHash,
            batchData.length
        );
    }

    /**
     * @notice Submit a fraud-proof-ready batch that references one or more EIP-4844 blob sidecars.
     * @dev The blob transaction must include blobs whose versioned hashes match blobVersionedHashes.
     *      daCommitment stores keccak256(abi.encodePacked(blobVersionedHashes)) so multi-blob
     *      batches can be authenticated without assuming a single 128 KiB blob limit.
     *      batchDataHash is the keccak256 of the canonical decoded batch bytes for challenger checks.
     */
    function submitStateBatchWithBlob(
        uint256 batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        bytes32[] calldata blobVersionedHashes,
        bytes32 batchDataHash,
        uint256 batchDataSize
    ) external {
        require(blobVersionedHashes.length > 0, "SequencerFacet: Empty blob hashes");
        require(batchDataHash != bytes32(0), "SequencerFacet: Invalid data hash");
        require(batchDataSize > 0, "SequencerFacet: Invalid data size");
        for (uint256 i = 0; i < blobVersionedHashes.length; i++) {
            require(blobVersionedHashes[i] != bytes32(0), "SequencerFacet: Invalid blob hash");
            bytes32 txBlobHash = _txBlobHash(i);
            require(txBlobHash != bytes32(0), "SequencerFacet: Missing tx blob");
            require(txBlobHash == blobVersionedHashes[i], "SequencerFacet: Blob hash mismatch");
        }
        require(_txBlobHash(blobVersionedHashes.length) == bytes32(0), "SequencerFacet: Unexpected extra blob");
        bytes32 blobHashCommitment = keccak256(abi.encodePacked(blobVersionedHashes));
        _submitStateBatchWithDA(
            batchNumber,
            l2StartBlock,
            l2EndBlock,
            preStateRoot,
            postStateRoot,
            transactionsRoot,
            withdrawalsRoot,
            DA_MODE_BLOB,
            blobHashCommitment,
            batchDataHash,
            batchDataSize
        );
    }

    function _submitStateBatchWithDA(
        uint256 batchNumber,
        uint256 l2StartBlock,
        uint256 l2EndBlock,
        bytes32 preStateRoot,
        bytes32 postStateRoot,
        bytes32 transactionsRoot,
        bytes32 withdrawalsRoot,
        uint8 daMode,
        bytes32 daCommitment,
        bytes32 daDataHash,
        uint256 daByteSize
    ) internal {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        require(isRegisteredSequencer(msg.sender), "SequencerFacet: Not registered");
        require(msg.sender == getCurrentSequencer(l2EndBlock), "SequencerFacet: Not your turn");
        require(l2EndBlock % BLOCKS_PER_ROTATION == 0, "SequencerFacet: Must submit at rotation boundary");
        require(batchNumber == l2EndBlock / BLOCKS_PER_ROTATION, "SequencerFacet: Invalid batch number");
        require(!s.batchRootSet[batchNumber], "SequencerFacet: Batch root already set");
        require(!s.stateCommitments[batchNumber].exists, "SequencerFacet: State commitment exists");
        require(batchNumber == s.latestBatchNumber + 1, "SequencerFacet: Batch not sequential");
        require(l2StartBlock == s.latestL2Block + 1, "SequencerFacet: Block range not continuous");
        require(l2StartBlock <= l2EndBlock, "SequencerFacet: Invalid block range");
        require(preStateRoot != bytes32(0) && postStateRoot != bytes32(0), "SequencerFacet: Invalid state root");
        require(transactionsRoot != bytes32(0), "SequencerFacet: Invalid transactions root");
        require(withdrawalsRoot != bytes32(0), "SequencerFacet: Invalid withdrawals root");
        require(daMode <= DA_MODE_BLOB, "SequencerFacet: Invalid DA mode");
        _enforceDAPolicy(s, batchNumber, daMode);
        if (daMode != DA_MODE_NONE) {
            require(daCommitment != bytes32(0), "SequencerFacet: Invalid DA commitment");
            require(daDataHash != bytes32(0), "SequencerFacet: Invalid DA hash");
            require(daByteSize > 0, "SequencerFacet: Invalid DA size");
        }

        if (s.stateCommitments[batchNumber - 1].exists) {
            require(
                preStateRoot == s.stateCommitments[batchNumber - 1].postStateRoot,
                "SequencerFacet: State root not chained"
            );
        }

        s.stateCommitments[batchNumber] = LibAppStorage.StateCommitmentData({
            l2StartBlock: l2StartBlock,
            l2EndBlock: l2EndBlock,
            preStateRoot: preStateRoot,
            postStateRoot: postStateRoot,
            transactionsRoot: transactionsRoot,
            withdrawalsRoot: withdrawalsRoot,
            timestamp: block.timestamp,
            sequencer: msg.sender,
            exists: true,
            daMode: daMode,
            daCommitment: daCommitment,
            daDataHash: daDataHash,
            daByteSize: daByteSize
        });

        s.batches[l2EndBlock] = LibAppStorage.Batch({
            stateRoot: postStateRoot,
            transactionsRoot: transactionsRoot,
            l2BlockNumber: l2EndBlock,
            l1BlockNumber: block.number,
            timestamp: block.timestamp,
            sequencer: msg.sender
        });

        s.batchWithdrawalRoots[batchNumber] = withdrawalsRoot;
        s.batchRootSet[batchNumber] = true;
        s.latestBatchNumber = batchNumber;
        s.latestL2Block = l2EndBlock;

        emit BatchSubmitted(l2EndBlock, postStateRoot, transactionsRoot, msg.sender, block.timestamp);
        emit BatchSubmittedV3(
            batchNumber, l2EndBlock, postStateRoot, transactionsRoot, withdrawalsRoot, msg.sender, block.timestamp
        );
        emit BatchStateCommitmentSubmitted(
            batchNumber,
            l2StartBlock,
            l2EndBlock,
            preStateRoot,
            postStateRoot,
            transactionsRoot,
            withdrawalsRoot,
            msg.sender,
            block.timestamp
        );
        if (daMode != DA_MODE_NONE) {
            emit BatchDataAvailabilityCommitted(batchNumber, daMode, daCommitment, daDataHash, daByteSize);
        }

        _recordBatchSubmittedIfConfigured(s);
    }

    /**
     * @notice Owner-only migration anchor for already submitted legacy batches.
     */
    function anchorStateCommitment(uint256 batchNumber, uint256 l2EndBlock, bytes32 postStateRoot) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        require(postStateRoot != bytes32(0), "SequencerFacet: Invalid state root");
        require(!_isDAPolicyActiveForBatch(s, batchNumber), "SequencerFacet: DA active for batch");
        require(!s.stateCommitments[batchNumber].exists, "SequencerFacet: State commitment exists");
        require(batchNumber == s.latestBatchNumber, "SequencerFacet: Anchor batch mismatch");
        require(l2EndBlock == s.latestL2Block, "SequencerFacet: Anchor block mismatch");

        s.stateCommitments[batchNumber] = LibAppStorage.StateCommitmentData({
            l2StartBlock: l2EndBlock,
            l2EndBlock: l2EndBlock,
            preStateRoot: postStateRoot,
            postStateRoot: postStateRoot,
            transactionsRoot: s.batches[l2EndBlock].transactionsRoot,
            withdrawalsRoot: s.batchWithdrawalRoots[batchNumber],
            timestamp: block.timestamp,
            sequencer: msg.sender,
            exists: true,
            daMode: DA_MODE_NONE,
            daCommitment: bytes32(0),
            daDataHash: bytes32(0),
            daByteSize: 0
        });

        emit StateCommitmentAnchored(batchNumber, l2EndBlock, postStateRoot);
    }

    function _submitBatch(uint256 l2BlockNumber, bytes32 stateRoot, bytes32 transactionsRoot, bytes32 withdrawalsRoot)
        internal
    {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        require(isRegisteredSequencer(msg.sender), "SequencerFacet: Not registered");

        address currentSeq = getCurrentSequencer(l2BlockNumber);
        require(msg.sender == currentSeq, "SequencerFacet: Not your turn");

        require(l2BlockNumber % BLOCKS_PER_ROTATION == 0, "SequencerFacet: Must submit at rotation boundary");

        require(l2BlockNumber > s.latestL2Block, "SequencerFacet: Block already submitted");
        require(stateRoot != bytes32(0), "SequencerFacet: Invalid state root");
        require(withdrawalsRoot != bytes32(0), "SequencerFacet: Invalid withdrawals root");

        uint256 batchNumber = l2BlockNumber / BLOCKS_PER_ROTATION;
        _enforceDAPolicy(s, batchNumber, DA_MODE_NONE);
        require(!s.batchRootSet[batchNumber], "SequencerFacet: Batch root already set");
        if (s.latestBatchNumber != 0) {
            require(batchNumber > s.latestBatchNumber, "SequencerFacet: Batch not monotonic");
        }

        s.batches[l2BlockNumber] = LibAppStorage.Batch({
            stateRoot: stateRoot,
            transactionsRoot: transactionsRoot,
            l2BlockNumber: l2BlockNumber,
            l1BlockNumber: block.number,
            timestamp: block.timestamp,
            sequencer: msg.sender
        });

        s.batchWithdrawalRoots[batchNumber] = withdrawalsRoot;
        s.batchRootSet[batchNumber] = true;
        s.latestBatchNumber = batchNumber;
        s.latestL2Block = l2BlockNumber;

        emit BatchSubmitted(l2BlockNumber, stateRoot, transactionsRoot, msg.sender, block.timestamp);

        emit BatchSubmittedV3(
            batchNumber, l2BlockNumber, stateRoot, transactionsRoot, withdrawalsRoot, msg.sender, block.timestamp
        );

        _recordBatchSubmittedIfConfigured(s);
    }

    function _txBlobHash(uint256 index) internal view returns (bytes32 txBlobHash) {
        assembly {
            txBlobHash := blobhash(index)
        }
    }

    function _isDAPolicyActiveForBatch(LibAppStorage.AppStorage storage s, uint256 batchNumber)
        internal
        view
        returns (bool)
    {
        return s.requiredDaMode != DA_MODE_NONE && s.daActivationBatch != 0 && batchNumber >= s.daActivationBatch;
    }

    function _enforceDAPolicy(LibAppStorage.AppStorage storage s, uint256 batchNumber, uint8 daMode) internal view {
        if (!_isDAPolicyActiveForBatch(s, batchNumber)) return;
        if (s.requiredDaMode == 1) {
            require(daMode == DA_MODE_CALLDATA || daMode == DA_MODE_BLOB, "SequencerFacet: DA required");
        } else if (s.requiredDaMode == DA_MODE_BLOB) {
            require(daMode == DA_MODE_BLOB, "SequencerFacet: Blob DA required");
        } else {
            revert("SequencerFacet: Invalid required DA mode");
        }
    }

    function _recordBatchSubmittedIfConfigured(LibAppStorage.AppStorage storage s) internal {
        address recorder = s.challengePeriodAddress;
        if (recorder != address(0)) {
            try IChallengeStatsRecorder(recorder).recordBatchSubmitted() {} catch {}
        }
    }

    // ═══════════════════════════════════════════════════════
    // ROTATION LOGIC
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Get current active sequencer for a given block number
     * @param l2BlockNumber L2 block number
     * @return address of current sequencer
     */
    function getCurrentSequencer(uint256 l2BlockNumber) public view returns (address) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        if (s.activeSequencers.length == 0) {
            return address(0);
        }

        // Calculate which sequencer's turn it is
        // Round-robin: rotationNumber % totalSequencers
        uint256 rotationNumber = l2BlockNumber / BLOCKS_PER_ROTATION;
        uint256 sequencerIndex = rotationNumber % s.activeSequencers.length;

        return s.activeSequencers[sequencerIndex];
    }

    /**
     * @notice Check if it's a specific sequencer's turn
     * @param sequencer Sequencer address
     * @param l2BlockNumber L2 block number
     */
    function isSequencerTurn(address sequencer, uint256 l2BlockNumber) external view returns (bool) {
        return getCurrentSequencer(l2BlockNumber) == sequencer;
    }

    /**
     * @notice Check if address is a registered sequencer
     * @param sequencer Address to check
     */
    function isRegisteredSequencer(address sequencer) public view returns (bool) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        for (uint256 i = 0; i < s.activeSequencers.length; i++) {
            if (s.activeSequencers[i] == sequencer) {
                return true;
            }
        }
        return false;
    }

    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Get all active sequencers
     */
    function getActiveSequencers() external view returns (address[] memory) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.activeSequencers;
    }

    /**
     * @notice Get total number of active sequencers
     */
    function getSequencerCount() external view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.activeSequencers.length;
    }

    /**
     * @notice Get batch details
     * @param l2BlockNumber L2 block number to query
     */
    function getBatch(uint256 l2BlockNumber)
        external
        view
        returns (
            bytes32 stateRoot,
            bytes32 transactionsRoot,
            uint256 l1BlockNumber,
            uint256 timestamp,
            address sequencer
        )
    {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        LibAppStorage.Batch memory batch = s.batches[l2BlockNumber];

        return (batch.stateRoot, batch.transactionsRoot, batch.l1BlockNumber, batch.timestamp, batch.sequencer);
    }

    /**
     * @notice Get latest submitted L2 block number
     */
    function getLatestL2Block() external view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.latestL2Block;
    }

    function getLatestBatchNumber() external view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (s.latestBatchNumber != 0) {
            return s.latestBatchNumber;
        }
        return s.latestL2Block / BLOCKS_PER_ROTATION;
    }

    function getBatchWithdrawalRoot(uint256 batchNumber) external view returns (bytes32) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        if (s.batchRootSet[batchNumber]) {
            return s.batchWithdrawalRoots[batchNumber];
        }
        return s.batches[batchNumber * BLOCKS_PER_ROTATION].stateRoot;
    }

    function getStateCommitment(uint256 batchNumber)
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
        LibAppStorage.StateCommitmentData memory c = LibAppStorage.appStorage().stateCommitments[batchNumber];
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

    function getStateCommitmentV2(uint256 batchNumber)
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
            bool exists,
            uint8 daMode,
            bytes32 daCommitment,
            bytes32 daDataHash,
            uint256 daByteSize
        )
    {
        LibAppStorage.StateCommitmentData memory c = LibAppStorage.appStorage().stateCommitments[batchNumber];
        return (
            c.l2StartBlock,
            c.l2EndBlock,
            c.preStateRoot,
            c.postStateRoot,
            c.transactionsRoot,
            c.withdrawalsRoot,
            c.timestamp,
            c.sequencer,
            c.exists,
            c.daMode,
            c.daCommitment,
            c.daDataHash,
            c.daByteSize
        );
    }

    function getBatchDACommitment(uint256 batchNumber)
        external
        view
        returns (uint8 daMode, bytes32 daCommitment, bytes32 daDataHash, uint256 daByteSize)
    {
        LibAppStorage.StateCommitmentData memory c = LibAppStorage.appStorage().stateCommitments[batchNumber];
        return (c.daMode, c.daCommitment, c.daDataHash, c.daByteSize);
    }

    function isBatchRootSet(uint256 batchNumber) external view returns (bool) {
        return LibAppStorage.appStorage().batchRootSet[batchNumber];
    }

    function getRequiredDAPolicy() external view returns (uint8 requiredDaMode, uint256 activationBatch) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return (s.requiredDaMode, s.daActivationBatch);
    }

    /**
     * @notice Get blocks per rotation constant
     */
    function getBlocksPerRotation() external pure returns (uint256) {
        return BLOCKS_PER_ROTATION;
    }

    // ═══════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════

    function setRequiredDAMode(uint8 mode, uint256 activationBatch) external {
        LibDiamond.enforceIsContractOwner();
        require(mode <= DA_MODE_BLOB, "SequencerFacet: Invalid required DA mode");
        if (mode != DA_MODE_NONE) {
            require(activationBatch != 0, "SequencerFacet: Invalid activation batch");
        }

        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        uint8 oldMode = s.requiredDaMode;
        uint256 oldActivationBatch = s.daActivationBatch;
        s.requiredDaMode = mode;
        s.daActivationBatch = mode == DA_MODE_NONE ? 0 : activationBatch;

        emit RequiredDAModeUpdated(oldMode, s.requiredDaMode, oldActivationBatch, s.daActivationBatch);
    }

    /**
     * @notice Add sequencer to rotation (owner only)
     * @dev Sequencers register on L2, owner verifies and adds them to L1 tracking
     * @param sequencer Sequencer address to add
     */
    function addSequencer(address sequencer) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        require(sequencer != address(0), "SequencerFacet: Invalid address");
        require(!isRegisteredSequencer(sequencer), "SequencerFacet: Already registered");

        s.activeSequencers.push(sequencer);

        emit SequencerAdded(sequencer, block.timestamp);
    }

    /**
     * @notice Add multiple sequencers at once (owner only)
     * @param sequencers Array of sequencer addresses
     */
    function addSequencers(address[] calldata sequencers) external {
        LibDiamond.enforceIsContractOwner();

        for (uint256 i = 0; i < sequencers.length; i++) {
            LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
            address sequencer = sequencers[i];

            require(sequencer != address(0), "SequencerFacet: Invalid address");
            require(!isRegisteredSequencer(sequencer), "SequencerFacet: Already registered");

            s.activeSequencers.push(sequencer);
            emit SequencerAdded(sequencer, block.timestamp);
        }
    }

    /**
     * @notice Remove sequencer from rotation (owner only)
     * @param sequencer Sequencer address to remove
     */
    function removeSequencer(address sequencer) external {
        LibDiamond.enforceIsContractOwner();
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();

        for (uint256 i = 0; i < s.activeSequencers.length; i++) {
            if (s.activeSequencers[i] == sequencer) {
                // Swap with last element and pop
                s.activeSequencers[i] = s.activeSequencers[s.activeSequencers.length - 1];
                s.activeSequencers.pop();

                emit SequencerRemoved(sequencer, block.timestamp);
                return;
            }
        }

        revert("SequencerFacet: Sequencer not found");
    }
}
