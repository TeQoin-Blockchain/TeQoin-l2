// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockStablecoin
/// @notice Freely mintable ERC20 used for TeQoin testnet bridge liquidity and faucet workflows.
contract MockStablecoin {
    string public name;
    string public symbol;
    uint8 private immutable _decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimalsValue
    ) {
        name = name_;
        symbol = symbol_;
        _decimals = decimalsValue;

        uint256 initialSupply = 1_000_000_000 * (10 ** decimalsValue);
        _mint(msg.sender, initialSupply);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MockStablecoin: insufficient allowance");

        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }

        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "MockStablecoin: invalid recipient");
        require(balanceOf[from] >= amount, "MockStablecoin: insufficient balance");

        unchecked {
            balanceOf[from] -= amount;
        }
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "MockStablecoin: invalid recipient");

        totalSupply += amount;
        balanceOf[to] += amount;

        emit Transfer(address(0), to, amount);
    }
}
