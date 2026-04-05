// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDiamondLoupe
 * @notice Interface for diamond loupe (inspection)
 * @dev EIP-2535 Diamond Standard
 */
interface IDiamondLoupe {
    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }
    
    /// @notice Gets all facet addresses and their four byte function selectors
    /// @return facets_ Facet
    function facets() external view returns (Facet[] memory facets_);
    
    /// @notice Gets all the function selectors supported by a specific facet
    /// @param _facet The facet address
    /// @return facetFunctionSelectors_
    function facetFunctionSelectors(address _facet) external view returns (bytes4[] memory facetFunctionSelectors_);
    
    /// @notice Get all the facet addresses used by a diamond
    /// @return facetAddresses_
    function facetAddresses() external view returns (address[] memory facetAddresses_);
    
    /// @notice Gets the facet that supports the given selector
    /// @param _functionSelector The function selector
    /// @return facetAddress_ The facet address
    function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_);
}