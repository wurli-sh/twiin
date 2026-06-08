// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;



// Per-agent spend guards: daily cap, per-task cap, kill switch, allowed-contracts list.
contract AgentPolicy {
    struct Policy {
        uint256   dailyCapWei;
        uint256   maxPerTaskWei;
        address[] allowedContracts;        // onchain.execute targets
        bool      killSwitch;
        uint256   dailySpent;
        uint256   lastResetDay;            // block.timestamp / 1 days
    }

    address public immutable deployer;
    address public           factory;
    address public           orchestrator;  // one-shot setter

    mapping(uint256 => Policy) public policies;  // personalAgentId → Policy

    event PolicySet(uint256 indexed personalAgentId);
    event KillSwitchToggled(uint256 indexed personalAgentId, bool killed);
    event OrchestratorSet(address indexed orchestrator);

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "only orchestrator");
        _;
    }

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

    function setOrchestrator(address _orchestrator) external {
        require(msg.sender == deployer, "only deployer");
        require(orchestrator == address(0), "set once");
        require(_orchestrator != address(0), "zero addr");
        orchestrator = _orchestrator;
        emit OrchestratorSet(_orchestrator);
    }

    // Called by Factory at deployTwiin and by NFT owner directly.
    function setPolicy(
        uint256 personalAgentId,
        uint256 dailyCapWei,
        uint256 maxPerTaskWei,
        address[] calldata allowedContracts,
        bool killSwitch
    ) external {
        require(msg.sender == factory || msg.sender == _agentOwner(personalAgentId), "not allowed");
        Policy storage p = policies[personalAgentId];
        p.dailyCapWei              = dailyCapWei;
        p.maxPerTaskWei            = maxPerTaskWei;
        p.killSwitch               = killSwitch;
        // Clear and reassign allowedContracts
        delete p.allowedContracts;
        for (uint256 i = 0; i < allowedContracts.length; i++) {
            p.allowedContracts.push(allowedContracts[i]);
        }
        emit PolicySet(personalAgentId);
    }

    function toggleKillSwitch(uint256 personalAgentId, bool killed) external {
        require(msg.sender == _agentOwner(personalAgentId), "not owner");
        policies[personalAgentId].killSwitch = killed;
        emit KillSwitchToggled(personalAgentId, killed);
    }

    /// @notice Full allowlist read — public mapping getter omits dynamic arrays.
    function getAllowedContracts(uint256 personalAgentId)
        external
        view
        returns (address[] memory)
    {
        return policies[personalAgentId].allowedContracts;
    }

    // ─── Orchestrator-only gates ───────────────────────────────────────────────

    // Called once at createTask. Validates and reserves budget against daily+task caps.
    function validateAndReserveTaskBudget(
        uint256 personalAgentId,
        uint256 budgetWei
    ) external onlyOrchestrator {
        Policy storage p = policies[personalAgentId];
        require(!p.killSwitch, "kill switch active");
        require(budgetWei <= p.maxPerTaskWei, "exceeds per-task cap");

        // Lazy daily reset
        uint256 today = block.timestamp / 1 days;
        if (today > p.lastResetDay) {
            p.dailySpent   = 0;
            p.lastResetDay = today;
        }
        require(p.dailySpent + budgetWei <= p.dailyCapWei, "daily cap exceeded");
        p.dailySpent += budgetWei;
    }

    // Non-mutating preflight — used by _preflightRefreshTask before pulling funds.
    function canReserveTaskBudget(
        uint256 personalAgentId,
        uint256 budgetWei
    ) external view returns (bool) {
        Policy storage p = policies[personalAgentId];
        if (p.killSwitch || budgetWei == 0) return false;
        if (budgetWei > p.maxPerTaskWei) return false;
        uint256 today = block.timestamp / 1 days;
        uint256 spent = today > p.lastResetDay ? 0 : p.dailySpent;
        return spent + budgetWei <= p.dailyCapWei;
    }

    // Credit back unused budget after task completes or aborts.
    // Same-day only — if the day rolled while the task ran, counter already reset.
    function releaseUnusedBudget(uint256 personalAgentId, uint256 amount) external onlyOrchestrator {
        Policy storage p = policies[personalAgentId];
        if (block.timestamp / 1 days != p.lastResetDay) return;
        if (amount >= p.dailySpent) p.dailySpent = 0;
        else p.dailySpent -= amount;
    }

    // Cheap per-step kill-switch gate. Per-task + daily caps reserved at createTask.
    function requireNotKilled(uint256 personalAgentId) external view onlyOrchestrator {
        require(!policies[personalAgentId].killSwitch, "kill switch active");
    }

    // Non-reverting view for Reactivity refresh preflight.
    function isKilled(uint256 personalAgentId) external view returns (bool) {
        return policies[personalAgentId].killSwitch;
    }

    // Verify target is in the allowed-contracts list before onchain.execute dispatch.
    function requireAllowed(uint256 personalAgentId, address target) external view onlyOrchestrator {
        Policy storage p = policies[personalAgentId];
        for (uint256 i = 0; i < p.allowedContracts.length; i++) {
            if (p.allowedContracts[i] == target) return;
        }
        revert("target not allowed");
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    address public twiinAgent;  // set by factory for owner lookup

    function setTwiinAgent(address _agent) external {
        require(msg.sender == deployer, "only deployer");
        require(twiinAgent == address(0), "set once");
        twiinAgent = _agent;
    }

    function _agentOwner(uint256 personalAgentId) internal view returns (address) {
        if (twiinAgent == address(0)) return address(0);
        (bool ok, bytes memory data) = twiinAgent.staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", personalAgentId)
        );
        if (!ok || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }
}
