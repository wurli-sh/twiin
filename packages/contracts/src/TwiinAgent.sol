// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ITwiinAgent, IOrchestrator} from "./interfaces/ITwiin.sol";

// ERC-721 where tokenId == personalAgentId.
// Ownership of the NFT is ownership of the agent.
contract TwiinAgent is ERC721 {
    using Strings for uint256;

    address       public immutable deployer;
    address       public           factory;
    IOrchestrator public           orchestrator;
    uint256       public           nextTokenId;  // 0 reserved; minted IDs start at 1

    event OrchestratorSet(address indexed orchestrator);

    constructor() ERC721("Twiin Agent", "TWIIN") {
        deployer = msg.sender;
    }

    // Called once by deployer after TwiinFactory is deployed.
    function setFactory(address _factory) external {
        require(msg.sender == deployer, "only deployer");
        require(factory == address(0), "set once");
        require(_factory != address(0), "zero addr");
        factory = _factory;
    }

    // Called once by deployer after Orchestrator is deployed (breaks the cyclic dep).
    function setOrchestrator(address _orchestrator) external {
        require(msg.sender == deployer, "only deployer");
        require(address(orchestrator) == address(0), "set once");
        require(_orchestrator != address(0), "zero addr");
        orchestrator = IOrchestrator(_orchestrator);
        emit OrchestratorSet(_orchestrator);
    }

    // Factory-only. Returns the freshly-minted tokenId == personalAgentId.
    function mintNext(address to) external returns (uint256 tokenId) {
        require(msg.sender == factory, "only factory");
        require(address(orchestrator) != address(0), "uninitialised");
        tokenId = ++nextTokenId;
        _safeMint(to, tokenId);
    }

    // Block transfer while a task is in flight (prevents handing buyer an in-progress task).
    // Also forbids burn — would orphan the 6551 account and all assets it holds.
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            require(orchestrator.taskLock(tokenId) == 0, "task in flight");
            require(to != address(0), "burn forbidden");
        }
        return super._update(to, tokenId, auth);
    }

    // Metadata backed by backend; data URI in v2.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "nonexistent");
        return string.concat("https://twiin.app/metadata/", tokenId.toString());
    }
}
