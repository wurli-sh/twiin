// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC6551Account} from "./interfaces/IERC6551Account.sol";
import {ITwiinAgent} from "./interfaces/ITwiin.sol";

// ERC-6551 reference account. One deterministic address per TwiinAgent NFT.
// Owner = IERC721(tokenContract).ownerOf(tokenId) — derived from immutable proxy footer.
//
// The proxy footer layout (written by ERC6551Registry.getCreationCode) is:
//   bytes32 salt | uint256 chainId | address tokenContract | uint256 tokenId
// at offset 0x23 from the start of the deployed bytecode.
// token() reads these values from the immutable bytecode via codecopy.
contract TwiinAccount is
    IERC6551Account,
    IERC1271,
    IERC721Receiver,
    IERC1155Receiver,
    ReentrancyGuard
{
    // The canonical TwiinAgent contract for this deployment.
    // Immutable — set in the implementation constructor; shared across all proxies.
    address public immutable twiinAgentAddr;

    // ERC-6551 nonce for replay protection.
    uint256 private _nonce;

    struct PullApproval {
        uint128 perTickWei;
        uint64  periodSeconds;
        uint64  lastPullAt;
    }
    mapping(address => PullApproval) public pullApprovals;

    event PullApprovalSet(address indexed subscriber, uint128 perTickWei, uint64 periodSeconds);
    event PullApprovalRevoked(address indexed subscriber);
    event RefreshPulled(address indexed subscriber, address indexed to, uint256 amount);

    constructor(address _twiinAgent) {
        require(_twiinAgent != address(0), "zero agent");
        twiinAgentAddr = _twiinAgent;
    }

    // ─── ERC-6551 token binding ───────────────────────────────────────────────

    // Reads (chainId, tokenContract, tokenId) from the immutable proxy footer.
    // Footer is appended by ERC6551Registry.getCreationCode at the end of the bytecode:
    //   abi.encode(salt, chainId, tokenContract, tokenId)  (4 × 32 bytes = 128 bytes)
    // We skip the first 32 bytes (salt) and read the remaining 96 bytes.
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(96);
        assembly {
            // Use extcodesize(address()) NOT codesize().
            // codesize() in DELEGATECALL returns the implementation's code size,
            // not the proxy's. extcodesize(address()) returns the proxy's deployed
            // bytecode size, which includes the 128-byte immutable footer appended
            // by ERC6551Registry.getCreationCode. We skip the first 32 bytes (salt)
            // and read the remaining 96 bytes (chainId + tokenContract + tokenId).
            extcodecopy(address(), add(footer, 0x20), sub(extcodesize(address()), 96), 96)
        }
        (chainId, tokenContract, tokenId) = abi.decode(footer, (uint256, address, uint256));
    }

    function state() external view returns (uint256) {
        return _nonce;
    }

    // ─── Ownership ────────────────────────────────────────────────────────────

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        require(chainId == block.chainid, "wrong chain");
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        if (signer == owner()) return IERC6551Account.isValidSigner.selector;
        return bytes4(0);
    }

    // ─── Execution ────────────────────────────────────────────────────────────

    // Only the NFT owner can call. operation must be 0 (CALL).
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external payable returns (bytes memory result) {
        require(msg.sender == owner(), "not owner");
        require(operation == 0, "only call");
        ++_nonce;
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) _revert(result);
    }

    receive() external payable {}

    // ─── EIP-1271 ─────────────────────────────────────────────────────────────

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external view returns (bytes4)
    {
        if (SignatureChecker.isValidSignatureNow(owner(), hash, signature)) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    // ─── Refresh pull allowance ───────────────────────────────────────────────

    // Returns the canonical Orchestrator address from TwiinAgent (set once at bootstrap).
    function _canonicalOrchestrator() internal view returns (address) {
        address o = ITwiinAgent(twiinAgentAddr).orchestrator();
        require(o != address(0), "orchestrator unset");
        return o;
    }

    // Owner pre-authorises the canonical Orchestrator to pull up to perTickWei
    // once per periodSeconds — enables chain-side Reactivity refreshes without
    // requiring an owner co-signature on every tick.
    function subscribePull(address subscriber, uint128 perTickWei, uint64 periodSeconds) external {
        require(msg.sender == owner(), "not owner");
        require(subscriber == _canonicalOrchestrator(), "subscriber not whitelisted");
        require(perTickWei > 0 && periodSeconds > 0, "bad params");
        PullApproval storage p = pullApprovals[subscriber];
        // Preserve lastPullAt — re-approval cannot reset the rate-limit clock (R4-13).
        p.perTickWei    = perTickWei;
        p.periodSeconds = periodSeconds;
        emit PullApprovalSet(subscriber, perTickWei, periodSeconds);
    }

    function revokePull(address subscriber) external {
        require(msg.sender == owner(), "not owner");
        delete pullApprovals[subscriber];
        emit PullApprovalRevoked(subscriber);
    }

    // Orchestrator calls this to pull refresh budget from the agent's wallet.
    // nonReentrant + CEI: lastPullAt updated BEFORE the external call.
    function pullForRefresh(address to, uint256 amount) external nonReentrant {
        PullApproval storage p = pullApprovals[msg.sender];
        require(p.perTickWei > 0, "no approval");
        require(amount <= p.perTickWei, "exceeds per-tick");
        require(block.timestamp >= p.lastPullAt + p.periodSeconds, "too soon");
        p.lastPullAt = uint64(block.timestamp);   // CEI: state before call
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer failed");
        emit RefreshPulled(msg.sender, to, amount);
    }

    // ─── ERC-721 / ERC-1155 receiver hooks ───────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _revert(bytes memory data) internal pure {
        assembly { revert(add(data, 0x20), mload(data)) }
    }
}
