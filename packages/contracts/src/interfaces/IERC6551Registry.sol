// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// CRITICAL: argument order must NOT be changed. Every _twiinAccount() derivation,
// TwiinFactory.deployTwiin, and TwiinAccount.token() depends on this exact layout.
interface IERC6551Registry {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    // Must match exactly: (implementation, salt, chainId, tokenContract, tokenId, initData)
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId,
        bytes calldata initData
    ) external returns (address account);

    // Must match exactly: (implementation, salt, chainId, tokenContract, tokenId)
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address account);
}
