// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Ported from the canonical erc6551/reference implementation.
// Deployed locally because the canonical singleton at
// 0x000000006551c19487814612e58FE06813775758 returns 0x on Somnia testnet.
//
// The CREATE2 salt and proxy bytecode layout are intentionally byte-for-byte
// compatible with the reference registry so TwiinAccount.token() can read
// the immutable footer via the same proxy encoding.

import {IERC6551Registry} from "../interfaces/IERC6551Registry.sol";

library ERC6551BytecodeLib {
    // ERC-1167 minimal proxy bytecode with immutable 6551 footer appended.
    // Layout (hex offsets after the 10-byte proxy header):
    //   0x00..0x09  10-byte EIP-1167 header
    //   0x0a..0x1d  implementation address (20 bytes)
    //   0x1e..0x22  5-byte EIP-1167 footer
    //   0x23..0x42  salt (32 bytes)       ─┐
    //   0x43..0x62  chainId (32 bytes)     │ immutable footer
    //   0x63..0x82  tokenContract (32 b)   │ read by TwiinAccount.token()
    //   0x83..0xa2  tokenId (32 bytes)    ─┘
    function getCreationCode(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(salt, chainId, tokenContract, tokenId)
        );
    }

    function computeAddress(
        bytes32 salt,
        bytes32 bytecodeHash,
        address deployer
    ) internal pure returns (address) {
        bytes32 rawHash = keccak256(
            abi.encodePacked(bytes1(0xff), deployer, salt, bytecodeHash)
        );
        return address(uint160(uint256(rawHash)));
    }
}

contract ERC6551Registry is IERC6551Registry {
    error InitializationFailed();

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId,
        bytes calldata initData
    ) external returns (address accountAddr) {
        bytes memory code = ERC6551BytecodeLib.getCreationCode(
            implementation, salt, chainId, tokenContract, tokenId
        );

        bytes32 codeHash = keccak256(code);
        accountAddr = ERC6551BytecodeLib.computeAddress(salt, codeHash, address(this));

        if (accountAddr.code.length == 0) {
            assembly {
                accountAddr := create2(0, add(code, 0x20), mload(code), salt)
            }
            if (accountAddr == address(0)) revert InitializationFailed();

            emit ERC6551AccountCreated(
                accountAddr, implementation, salt, chainId, tokenContract, tokenId
            );
        }

        if (initData.length > 0) {
            (bool ok, ) = accountAddr.call(initData);
            if (!ok) revert InitializationFailed();
        }
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address accountAddr) {
        bytes memory code = ERC6551BytecodeLib.getCreationCode(
            implementation, salt, chainId, tokenContract, tokenId
        );
        bytes32 codeHash = keccak256(code);
        return ERC6551BytecodeLib.computeAddress(salt, codeHash, address(this));
    }
}
