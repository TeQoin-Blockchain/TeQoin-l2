// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";

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
    
    event SequencerAdded(
        address indexed sequencer,
        uint256 timestamp
    );
    
    event SequencerRemoved(
        address indexed sequencer,
        uint256 timestamp
    );
    
    event BatchSubmitted(
        uint256 indexed l2BlockNumber,
        bytes32 indexed stateRoot,
        bytes32 transactionsRoot,
        address indexed sequencer,
        uint256 timestamp
    );
    
    // ═══════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════
    
    uint256 constant BLOCKS_PER_ROTATION = 100;
    
    // ═══════════════════════════════════════════════════════
    // BATCH SUBMISSION
    // ═══════════════════════════════════════════════════════
    
    /**
     * @notice Submit a batch of L2 blocks to L1
     * @param l2BlockNumber L2 block number (must be multiple of 100)
     * @param stateRoot State root at this block
     * @param transactionsRoot Transactions Merkle root
     */
    function submitBatch(
        uint256 l2BlockNumber,
        bytes32 stateRoot,
        bytes32 transactionsRoot
    ) external {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        
        // Verify caller is registered sequencer
        require(isRegisteredSequencer(msg.sender), "SequencerFacet: Not registered");
        
        // Verify it's their turn
        address currentSeq = getCurrentSequencer(l2BlockNumber);
        require(msg.sender == currentSeq, "SequencerFacet: Not your turn");
        
        // Verify block number is at rotation boundary
        require(
            l2BlockNumber % BLOCKS_PER_ROTATION == 0,
            "SequencerFacet: Must submit at rotation boundary"
        );
        
        require(l2BlockNumber > s.latestL2Block, "SequencerFacet: Block already submitted");
        require(stateRoot != bytes32(0), "SequencerFacet: Invalid state root");
        
        // Store batch
        s.batches[l2BlockNumber] = LibAppStorage.Batch({
            stateRoot: stateRoot,
            transactionsRoot: transactionsRoot,
            l2BlockNumber: l2BlockNumber,
            l1BlockNumber: block.number,
            timestamp: block.timestamp,
            sequencer: msg.sender
        });
        
        s.latestL2Block = l2BlockNumber;
        
        emit BatchSubmitted(
            l2BlockNumber,
            stateRoot,
            transactionsRoot,
            msg.sender,
            block.timestamp
        );
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
        
        for (uint i = 0; i < s.activeSequencers.length; i++) {
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
        
        return (
            batch.stateRoot,
            batch.transactionsRoot,
            batch.l1BlockNumber,
            batch.timestamp,
            batch.sequencer
        );
    }
    
    /**
     * @notice Get latest submitted L2 block number
     */
    function getLatestL2Block() external view returns (uint256) {
        LibAppStorage.AppStorage storage s = LibAppStorage.appStorage();
        return s.latestL2Block;
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
        
        for (uint i = 0; i < sequencers.length; i++) {
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
        
        for (uint i = 0; i < s.activeSequencers.length; i++) {
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