// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "../libraries/LibDiamond.sol";

/**
 * @title OwnershipFacet
 * @notice Facet for managing ownership of the Diamond
 */
contract OwnershipFacet {
    
    /**
     * @notice Transfer ownership of Diamond
     * @param _newOwner The new owner address
     */
    function transferOwnership(address _newOwner) external {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.setContractOwner(_newOwner);
    }
    
    /**
     * @notice Get the current owner of Diamond
     * @return owner_ The owner address
     */
    function owner() external view returns (address owner_) {
        owner_ = LibDiamond.contractOwner();
    }
}