// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

// Unified name@twiin namespace shared by personal agents and sub-agents.
// Names are claimed-once, never released in v1.
contract TwiinNames {
    enum AgentKind { None, Personal, SubAgent }

    struct AgentRef {
        AgentKind kind;
        uint256   id;
    }

    address public immutable deployer;
    address public           factory;
    address public           twiinAgent;   // one-shot setter
    address public           registry;     // one-shot setter

    // Both keyed by keccak256(lowercaseName).
    mapping(bytes32 => AgentRef) public nameToAgent;
    mapping(AgentKind => mapping(uint256 => string)) public agentName;

    event NameClaimed(AgentKind indexed kind, uint256 indexed id, string name);
    event TwiinAgentSet(address indexed twiinAgent);
    event RegistrySet(address indexed registry);

    constructor() {
        deployer = msg.sender;
    }

    // Called once by deployer after TwiinFactory is deployed.
    function setFactory(address _factory) external {
        require(msg.sender == deployer, "only deployer");
        require(factory == address(0), "set once");
        require(_factory != address(0), "zero addr");
        factory = _factory;
    }

    function setTwiinAgent(address a) external {
        require(msg.sender == deployer, "only deployer");
        require(twiinAgent == address(0), "set once");
        require(a != address(0), "zero addr");
        twiinAgent = a;
        emit TwiinAgentSet(a);
    }

    function setRegistry(address r) external {
        require(msg.sender == deployer, "only deployer");
        require(registry == address(0), "set once");
        require(r != address(0), "zero addr");
        registry = r;
        emit RegistrySet(r);
    }

    // ─── Claim paths ─────────────────────────────────────────────────────────

    // NFT owner claims a personal agent name.
    function claimPersonalName(uint256 personalAgentId, string calldata name) external {
        _requireInitialised();
        require(msg.sender == IERC721(twiinAgent).ownerOf(personalAgentId), "not owner");
        require(bytes(agentName[AgentKind.Personal][personalAgentId]).length == 0, "named");
        _claim(AgentKind.Personal, personalAgentId, name);
    }

    // Factory single-tx deploy path: Factory mints NFT to user then claims name on their behalf.
    function claimPersonalNameFor(address nftOwner, uint256 personalAgentId, string calldata name) external {
        require(msg.sender == factory, "only factory");
        _requireInitialised();
        require(nftOwner != address(0), "zero owner");
        require(nftOwner == IERC721(twiinAgent).ownerOf(personalAgentId), "not owner");
        require(bytes(agentName[AgentKind.Personal][personalAgentId]).length == 0, "named");
        _claim(AgentKind.Personal, personalAgentId, name);
    }

    // AgentRegistry calls this inside registerNative / registerExternalAgent.
    function claimSubAgentName(uint256 configId, string calldata name) external {
        require(msg.sender == registry, "only registry");
        require(bytes(agentName[AgentKind.SubAgent][configId]).length == 0, "named");
        _claim(AgentKind.SubAgent, configId, name);
    }

    function resolve(string calldata name) external view returns (AgentKind, uint256) {
        AgentRef memory r = nameToAgent[keccak256(bytes(_toLower(name)))];
        return (r.kind, r.id);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _requireInitialised() internal view {
        require(twiinAgent != address(0) && registry != address(0), "uninitialised");
    }

    function _claim(AgentKind kind, uint256 id, string calldata name) internal {
        require(_isValidName(name), "bad name");
        bytes32 h = keccak256(bytes(_toLower(name)));
        require(nameToAgent[h].kind == AgentKind.None, "name taken");
        nameToAgent[h] = AgentRef({kind: kind, id: id});
        agentName[kind][id] = name;
        emit NameClaimed(kind, id, name);
    }

    // Valid: [a-z0-9-], 3..32 chars, no reserved prefixes (checked on lowercased).
    function _isValidName(string calldata name) internal pure returns (bool) {
        bytes calldata b = bytes(name);
        if (b.length < 3 || b.length > 32) return false;

        // Reserved prefix checks (after lowercasing, done by caller)
        if (_hasPrefix(b, "system-")) return false;
        if (_hasPrefix(b, "twiin-"))  return false;
        if (_hasPrefix(b, "admin-"))  return false;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool isLower  = (c >= 0x61 && c <= 0x7a); // a-z
            bool isDigit  = (c >= 0x30 && c <= 0x39); // 0-9
            bool isHyphen = (c == 0x2d);               // -
            if (!isLower && !isDigit && !isHyphen) return false;
        }
        return true;
    }

    function _hasPrefix(bytes calldata b, string memory prefix) internal pure returns (bool) {
        bytes memory p = bytes(prefix);
        if (b.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (b[i] != p[i]) return false;
        }
        return true;
    }

    // ASCII-only lowercase (a-z normalisation for homoglyph protection).
    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory result = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x41 && c <= 0x5a) {
                result[i] = bytes1(uint8(c) + 32);
            } else {
                result[i] = c;
            }
        }
        return string(result);
    }
}
