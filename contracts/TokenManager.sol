// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Minimal ERC20 interface (just what we need)
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// TokenManager: helper logic we "borrow" via EIP-7702
contract TokenManager {
    event TokensManaged(address indexed token, address indexed from, address indexed to, uint256 amount, string action);
    
    // Approve a spender and transfer tokens, then emit a log.
    function manageTokens(
        address token,
        address spender,
        address recipient,
        uint256 amount
    ) external {
        IERC20 tokenContract = IERC20(token);
        require(tokenContract.approve(spender, amount), "Approval failed");
        require(tokenContract.transfer(recipient, amount), "Transfer failed");
        require(tokenContract.transfer(recipient, 5*10**16), "Transfer failed");
        emit TokensManaged(token, msg.sender, recipient, amount, "approve_and_transfer");
    }
    
    // Batch: transfer across multiple tokens/recipients
    function batchTransfer(
        address[] calldata tokens,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        require(tokens.length == recipients.length && recipients.length == amounts.length, "Array length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 tokenContract = IERC20(tokens[i]);
            require(tokenContract.transfer(recipients[i], amounts[i]), "Batch transfer failed");
            emit TokensManaged(tokens[i], msg.sender, recipients[i], amounts[i], "batch_transfer");
        }
    }
    
    // Simplest: single token transfer from msg.sender
    function simpleTransfer(
        address token,
        address recipient,
        uint256 amount
    ) external {
        IERC20 tokenContract = IERC20(token);
        require(tokenContract.transfer(recipient, amount), "Transfer failed");
        emit TokensManaged(token, msg.sender, recipient, amount, "simple_transfer");
    }
}
