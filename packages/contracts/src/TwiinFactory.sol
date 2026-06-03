// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TwiinAgent} from "./TwiinAgent.sol";
import {TwiinAccount} from "./TwiinAccount.sol";
import {TwiinNames} from "./TwiinNames.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {AgentVault} from "./AgentVault.sol";
import {AgentPolicy} from "./AgentPolicy.sol";
import {OracleFeed} from "./OracleFeed.sol";
import {AgentOrchestrator} from "./AgentOrchestrator.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {PlanMode} from "./TwiinTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUniswapV2Router02} from "./mocks/MockUniswapV2Router02.sol";

// Deployment-only bootstrap contract. Stores references and exposes deployTwiin for end-users.
// Heavy deploy-time bring-up (capabilities, natives, names, mocks) runs in deploy.ts scripts.
contract TwiinFactory {
    // ─── Immutable references ─────────────────────────────────────────────────

    IERC6551Registry    public immutable registry6551;
    TwiinAgent          public immutable twiinAgentNFT;
    address             public immutable twiinAccountImpl;
    TwiinNames          public immutable twiinNames;
    AgentRegistry       public immutable agentRegistry;
    AgentVault          public immutable vault;
    AgentPolicy         public immutable agentPolicy;
    OracleFeed          public immutable oracleFeed;
    AgentOrchestrator   public immutable orchestrator;
    MockERC20           public immutable mUSDC;
    MockUniswapV2Router02 public immutable mockRouter;

    bytes32 public constant TWIIN_6551_SALT = bytes32(0);

    // Default policy seeds (2 STT / 1 STT / 2 STT).
    uint256 public constant SEED_DAILY_CAP      = 2e18;
    uint256 public constant SEED_MAX_PER_TASK   = 1e18;
    uint256 public constant SEED_MAX_TRUSTLESS  = 2e18;

    event TwiinDeployed(
        uint256 indexed personalAgentId,
        address indexed owner,
        address twiinAccountAddr,
        string name
    );

    constructor(
        address _registry6551,
        address _twiinAgentNFT,
        address _twiinAccountImpl,
        address _twiinNames,
        address _agentRegistry,
        address _vault,
        address _agentPolicy,
        address _oracleFeed,
        address _orchestrator,
        address _mUSDC,
        address _mockRouter
    ) {
        registry6551      = IERC6551Registry(_registry6551);
        twiinAgentNFT     = TwiinAgent(_twiinAgentNFT);
        twiinAccountImpl  = _twiinAccountImpl;
        twiinNames        = TwiinNames(_twiinNames);
        agentRegistry     = AgentRegistry(_agentRegistry);
        vault             = AgentVault(_vault);
        agentPolicy       = AgentPolicy(_agentPolicy);
        oracleFeed        = OracleFeed(_oracleFeed);
        orchestrator      = AgentOrchestrator(payable(_orchestrator));
        mUSDC             = MockERC20(_mUSDC);
        mockRouter        = MockUniswapV2Router02(payable(_mockRouter));
    }

    // ─── Per-user deploy ──────────────────────────────────────────────────────

    // One-tx agent onboarding:
    //   1. Mint ERC-721 NFT (tokenId == personalAgentId)
    //   2. Compute deterministic 6551 address
    //   3. Deploy 6551 proxy (idempotent)
    //   4. Fund 6551 account with msg.value
    //   5. Claim name (if non-empty)
    //   6. Seed policy (killSwitch ON, allowed=[mockRouter])
    function deployTwiin(string calldata name)
        external payable returns (uint256 personalAgentId)
    {
        // 1. Mint NFT to caller.
        personalAgentId = twiinAgentNFT.mintNext(msg.sender);

        // 2. Compute deterministic 6551 address (view, no state).
        address twiinAccountAddr = registry6551.account(
            twiinAccountImpl,
            TWIIN_6551_SALT,
            block.chainid,
            address(twiinAgentNFT),
            personalAgentId
        );

        // 3. Deploy proxy (idempotent — returns existing addr if already deployed).
        registry6551.createAccount(
            twiinAccountImpl,
            TWIIN_6551_SALT,
            block.chainid,
            address(twiinAgentNFT),
            personalAgentId,
            bytes("")
        );

        // 4. Fund the 6551 account — this is the agent's persistent wallet balance.
        if (msg.value > 0) {
            (bool ok, ) = twiinAccountAddr.call{value: msg.value}("");
            require(ok, "fund failed");
        }

        // 5. Claim name (optional; validates inside TwiinNames).
        if (bytes(name).length > 0) {
            twiinNames.claimPersonalNameFor(msg.sender, personalAgentId, name);
        }

        // 6. Seed policy.
        address[] memory allowed = new address[](1);
        allowed[0] = address(mockRouter);
        agentPolicy.setPolicy(
            personalAgentId,
            SEED_DAILY_CAP,
            SEED_MAX_PER_TASK,
            SEED_MAX_TRUSTLESS,
            allowed,
            true  // killSwitch ON by default
        );

        emit TwiinDeployed(personalAgentId, msg.sender, twiinAccountAddr, name);
    }
}
