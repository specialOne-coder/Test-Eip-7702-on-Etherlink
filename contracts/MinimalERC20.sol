// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Very small ERC20 for demos/tests.
// - All supply minted to deployer.
// - Minimal events and checks.
contract MinimalERC20 {
    string public name = "TestToken";
    string public symbol = "TT";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // Mint entire supply to deployer
    constructor(uint256 _supply) {
        balanceOf[msg.sender] = _supply;
        totalSupply = _supply;
        emit Transfer(address(0), msg.sender, _supply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "bal");
        unchecked { balanceOf[msg.sender] -= value; balanceOf[to] += value; }
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "bal");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allow");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        unchecked { balanceOf[from] -= value; balanceOf[to] += value; }
        emit Transfer(from, to, value);
        return true;
    }
}

