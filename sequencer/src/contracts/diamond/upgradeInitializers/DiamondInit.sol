// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DiamondInit
 * @notice Initialization contract for Diamond
 * @dev This contract is used to initialize state variables during diamond deployment or upgrades
 * 
 * IMPORTANT: This contract is executed via delegatecall from Diamond, so:
 * - State changes affect Diamond's storage
 * - msg.sender is the original caller (not Diamond)
 * - Can only be called once via diamondCut
 */
contract DiamondInit {
    
    /**
     * @notice Initialize Diamond with initial state
     * @dev Called once during deployment via diamondCut
     * @param _args ABI encoded initialization arguments
     */
    function init(bytes memory _args) external {
        // Decode initialization arguments
        (
            address teqToken,
            uint256 challengePeriod,
            uint256 blocksPerRotation,
            uint256 stakeAmount
        ) = abi.decode(_args, (address, uint256, uint256, uint256));
        
        // Initialize storage (using AppStorage pattern if needed)
        // For now, we'll initialize via individual facet setters after deployment
        
        // This is a placeholder - actual initialization will be done
        // when we add facets in the next steps
        
        require(teqToken != address(0), "DiamondInit: Invalid TEQ token");
        require(challengePeriod > 0, "DiamondInit: Invalid challenge period");
        require(blocksPerRotation > 0, "DiamondInit: Invalid blocks per rotation");
        require(stakeAmount > 0, "DiamondInit: Invalid stake amount");
    }
}