// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TwiinNames} from "./TwiinNames.sol";
import {AgentLane} from "./TwiinTypes.sol";

// Sub-agent registry — two lanes: SomniaNative (configIds 0–5) and ExternalHTTP (6+).
// Elo re-sorted (insertion sort) on every write; O(N) acceptable at hackathon density.
contract AgentRegistry {
    struct Capability {
        bytes32 id;
        string  name;
        uint8   minTrustTier;
        bool    nativeOnly;
    }

    struct SubAgent {
        string      name;
        AgentLane   lane;
        bytes32[]   capabilities;
        uint256     costWei;
        uint256     eloScore;         // 1200 init; floor 800; delta cap ±32
        bool        isActive;
        uint64      tasksCompleted;
        uint64      tasksFailed;
        uint32      avgLatencyMs;
        uint8       trustTier;

        // SomniaNative only
        uint256     somniaAgentId;
        bytes       defaultPayload;

        // ExternalHTTP only
        address     registrant;
        bytes32     endpointHash;     // endpointUrl NOT stored; emitted in event
        uint256     depositWei;
        bool        suspended;
        uint64      registeredAt;
    }

    uint256 public constant SLASH_AMOUNT       = 0.25e18;
    uint256 public constant MIN_EXTERNAL_DEPOSIT = 5e18;
    uint64  public constant DEREGISTER_LOCKUP  = 86400;  // 24h
    uint256 public constant MAX_ELO            = 3000;
    uint256 public constant MIN_ELO            = 800;
    uint256 public constant ELO_START          = 1200;

    address public immutable deployer;
    address public           orchestrator;   // one-shot setter
    TwiinNames public        twiinNames;     // one-shot setter (via deployer)

    mapping(uint256 => SubAgent)  public agents;
    uint256                       public nextConfigId;  // starts at 6; 0–5 reserved for native
    mapping(bytes32 => uint256[]) public byCapability;  // capability id → configIds (Elo-sorted)
    mapping(bytes32 => uint256)   public configIdByName;
    mapping(uint256 => uint256)   public activeStepCount;
    mapping(bytes32 => bool)      public reservedSubAgentName;
    mapping(bytes32 => Capability) public capabilities;

    uint256 public slashPool;

    event CapabilityRegistered(bytes32 indexed id, string name, uint8 minTrustTier, bool nativeOnly);
    event SubAgentNameReserved(string name);
    event NativeAgentRegistered(uint256 indexed configId, string name, bytes32[] caps, uint256 costWei);
    event ExternalAgentRegistered(uint256 indexed configId, address indexed registrant, string endpointUrl, bytes32 endpointHash, bytes32[] caps, uint256 costWei);
    event ExternalCostUpdated(uint256 indexed configId, uint256 newCostWei);
    event ExternalEndpointUpdated(uint256 indexed configId, string newUrl, bytes32 newHash);
    event ExternalDeregistered(uint256 indexed configId, address indexed registrant);
    event EloUpdated(uint256 indexed configId, uint256 oldElo, uint256 newElo);
    event AgentSuspended(uint256 indexed configId);
    event OrchestratorSet(address indexed orchestrator);
    event TwiinNamesSet(address indexed twiinNames);

    modifier onlyAdmin() {
        require(msg.sender == deployer, "only admin");
        _;
    }

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "only orchestrator");
        _;
    }

    constructor() {
        deployer = msg.sender;
        nextConfigId = 6;  // 0–5 reserved for native
    }

    // ─── One-shot wiring ─────────────────────────────────────────────────────

    function setOrchestrator(address _orchestrator) external onlyAdmin {
        require(orchestrator == address(0), "set once");
        require(_orchestrator != address(0), "zero addr");
        orchestrator = _orchestrator;
        emit OrchestratorSet(_orchestrator);
    }

    function setTwiinNames(address _names) external onlyAdmin {
        require(address(twiinNames) == address(0), "set once");
        require(_names != address(0), "zero addr");
        twiinNames = TwiinNames(_names);
        emit TwiinNamesSet(_names);
    }

    // ─── Capability management ────────────────────────────────────────────────

    function registerCapability(
        bytes32 id, string calldata capName, uint8 minTrustTier, bool nativeOnly
    ) external onlyAdmin {
        require(id != bytes32(0), "bad id");
        require(capabilities[id].id == bytes32(0), "capability exists");
        capabilities[id] = Capability({id: id, name: capName, minTrustTier: minTrustTier, nativeOnly: nativeOnly});
        emit CapabilityRegistered(id, capName, minTrustTier, nativeOnly);
    }

    function reserveSubAgentName(string calldata name) external onlyAdmin {
        reservedSubAgentName[keccak256(bytes(_toLower(name)))] = true;
        emit SubAgentNameReserved(name);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    // Admin-only. configId must be 0–5. Claims sub-agent name in TwiinNames.
    function registerNative(
        uint256 configId,
        string calldata agentName,
        uint256 somniaAgentId,
        bytes calldata defaultPayload,
        uint256 costWei,
        bytes32[] calldata caps,
        uint8 trustTier
    ) external onlyAdmin {
        require(configId < 6, "reserved for native");
        require(!agents[configId].isActive, "configId taken");
        _validateCaps(caps);

        agents[configId] = SubAgent({
            name: agentName,
            lane: AgentLane.SomniaNative,
            capabilities: caps,
            costWei: costWei,
            eloScore: ELO_START,
            isActive: true,
            tasksCompleted: 0,
            tasksFailed: 0,
            avgLatencyMs: 0,
            trustTier: trustTier,
            somniaAgentId: somniaAgentId,
            defaultPayload: defaultPayload,
            registrant: address(0),
            endpointHash: bytes32(0),
            depositWei: 0,
            suspended: false,
            registeredAt: uint64(block.timestamp)
        });

        _insertByCapability(configId, caps);
        twiinNames.claimSubAgentName(configId, agentName);
        emit NativeAgentRegistered(configId, agentName, caps, costWei);
    }

    // Permissionless external registration. endpointUrl NOT stored on-chain.
    function registerExternalAgent(
        string calldata agentName,
        string calldata endpointUrl,
        uint256 costWei,
        bytes32[] calldata caps
    ) external payable returns (uint256 configId) {
        require(msg.value >= MIN_EXTERNAL_DEPOSIT, "deposit required");
        require(!reservedSubAgentName[keccak256(bytes(_toLower(agentName)))], "reserved name");
        require(bytes(endpointUrl).length > 0 && bytes(endpointUrl).length <= 256, "bad url");
        require(bytes(agentName).length > 0 && bytes(agentName).length <= 32, "bad name");
        require(costWei > 0, "bad cost");
        _validateExternalCaps(caps);

        configId = nextConfigId++;
        bytes32 epHash = keccak256(bytes(endpointUrl));

        agents[configId] = SubAgent({
            name: agentName,
            lane: AgentLane.ExternalHTTP,
            capabilities: caps,
            costWei: costWei,
            eloScore: ELO_START,
            isActive: true,
            tasksCompleted: 0,
            tasksFailed: 0,
            avgLatencyMs: 0,
            trustTier: 0,
            somniaAgentId: 0,
            defaultPayload: bytes(""),
            registrant: msg.sender,
            endpointHash: epHash,
            depositWei: msg.value,
            suspended: false,
            registeredAt: uint64(block.timestamp)
        });

        configIdByName[keccak256(bytes(agentName))] = configId;
        _insertByCapability(configId, caps);
        twiinNames.claimSubAgentName(configId, agentName);
        emit ExternalAgentRegistered(configId, msg.sender, endpointUrl, epHash, caps, costWei);
    }

    function deregisterExternal(uint256 configId) external {
        SubAgent storage a = agents[configId];
        require(a.registrant == msg.sender, "not registrant");
        require(block.timestamp >= a.registeredAt + DEREGISTER_LOCKUP, "lockup active");
        require(activeStepCount[configId] == 0, "active step pending");

        uint256 refund = a.suspended ? 0 : a.depositWei;
        a.isActive = false;
        a.depositWei = 0;
        configIdByName[keccak256(bytes(a.name))] = 0;
        // Name stays reserved in TwiinNames (R4-6: prevents brand-jacking).
        _removeByCapability(configId, a.capabilities);

        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund failed");
        }
        emit ExternalDeregistered(configId, msg.sender);
    }

    function updateEndpoint(uint256 configId, string calldata newUrl) external {
        SubAgent storage a = agents[configId];
        require(a.registrant == msg.sender, "not registrant");
        require(bytes(newUrl).length > 0 && bytes(newUrl).length <= 256, "bad url");
        a.endpointHash = keccak256(bytes(newUrl));
        emit ExternalEndpointUpdated(configId, newUrl, a.endpointHash);
    }

    function updateCost(uint256 configId, uint256 newCostWei) external {
        SubAgent storage a = agents[configId];
        require(a.lane == AgentLane.ExternalHTTP, "external only");
        require(a.registrant == msg.sender, "not registrant");
        require(newCostWei > 0, "bad cost");
        a.costWei = newCostWei;
        emit ExternalCostUpdated(configId, newCostWei);
    }

    // ─── Orchestrator callbacks ───────────────────────────────────────────────

    function recordSuccess(uint256 configId, uint32 latencyMs, uint8 score0to100)
        external onlyOrchestrator
    {
        SubAgent storage a = agents[configId];
        a.tasksCompleted++;
        // EMA latency update (alpha = 0.1)
        if (a.avgLatencyMs == 0) a.avgLatencyMs = latencyMs;
        else a.avgLatencyMs = uint32((uint256(a.avgLatencyMs) * 9 + latencyMs) / 10);
        _updateElo(configId, score0to100);
    }

    function recordFailure(uint256 configId, bool slash) external onlyOrchestrator {
        SubAgent storage a = agents[configId];
        a.tasksFailed++;
        if (slash && a.lane == AgentLane.ExternalHTTP) {
            uint256 seize = a.depositWei < SLASH_AMOUNT ? a.depositWei : SLASH_AMOUNT;
            a.depositWei -= seize;
            slashPool += seize;
            if (a.depositWei == 0) {
                a.suspended = true;
                emit AgentSuspended(configId);
            }
        }
        _updateElo(configId, 0);
    }

    function incrementActiveStep(uint256 configId) external onlyOrchestrator {
        activeStepCount[configId]++;
    }

    function decrementActiveStep(uint256 configId) external onlyOrchestrator {
        if (activeStepCount[configId] > 0) activeStepCount[configId]--;
    }

    function get(uint256 configId) external view returns (SubAgent memory) {
        return agents[configId];
    }

    function getByCapability(bytes32 cap) external view returns (uint256[] memory) {
        return byCapability[cap];
    }

    // ─── Elo ─────────────────────────────────────────────────────────────────

    // Piecewise-linear approximation of logistic expected score.
    // True formula: 1 / (1 + 10^((1200-elo)/400))
    // Approximated over bands [800,1000), [1000,1200), [1200,1400), [1400+)
    // as multiplied-by-100 integer values for fixed-point delta calculation.
    function _expectedScore100(uint256 elo) internal pure returns (uint256) {
        if (elo <  900) return 20;   // ~0.20
        if (elo < 1000) return 26;   // ~0.26
        if (elo < 1100) return 32;   // ~0.32
        if (elo < 1200) return 40;   // ~0.40
        if (elo < 1300) return 50;   // ~0.50 (baseline)
        if (elo < 1400) return 60;   // ~0.60
        if (elo < 1600) return 69;   // ~0.69
        if (elo < 1800) return 76;   // ~0.76
        return 80;
    }

    function _updateElo(uint256 configId, uint8 score0to100) internal {
        SubAgent storage a = agents[configId];
        uint256 oldElo = a.eloScore;
        uint256 expected100 = _expectedScore100(oldElo);  // 0–100 scale
        uint256 actual100   = score0to100;

        // delta = 32 * (actual - expected) — signed, clamped to ±32
        int256 delta;
        if (actual100 >= expected100) {
            delta = int256(((actual100 - expected100) * 32) / 100);
            if (delta > 32) delta = 32;
        } else {
            delta = -int256(((expected100 - actual100) * 32) / 100);
            if (delta < -32) delta = -32;
        }

        uint256 newElo;
        if (delta >= 0) {
            newElo = oldElo + uint256(delta);
        } else {
            uint256 absDelta = uint256(-delta);
            newElo = oldElo > absDelta + MIN_ELO ? oldElo - absDelta : MIN_ELO;
        }
        if (newElo > MAX_ELO) newElo = MAX_ELO;
        if (newElo < MIN_ELO) newElo = MIN_ELO;

        a.eloScore = newElo;
        emit EloUpdated(configId, oldElo, newElo);
        _resortByCapability(configId, a.capabilities);
    }

    // ─── byCapability helpers ────────────────────────────────────────────────

    function _insertByCapability(uint256 configId, bytes32[] memory caps) internal {
        for (uint256 i = 0; i < caps.length; i++) {
            uint256[] storage arr = byCapability[caps[i]];
            // Simple append then sort
            arr.push(configId);
            _sortByElo(arr);
        }
    }

    function _removeByCapability(uint256 configId, bytes32[] memory caps) internal {
        for (uint256 i = 0; i < caps.length; i++) {
            uint256[] storage arr = byCapability[caps[i]];
            uint256 len = arr.length;
            for (uint256 j = 0; j < len; j++) {
                if (arr[j] == configId) {
                    arr[j] = arr[len - 1];
                    arr.pop();
                    break;
                }
            }
        }
    }

    function _resortByCapability(uint256 configId, bytes32[] memory caps) internal {
        for (uint256 i = 0; i < caps.length; i++) {
            uint256[] storage arr = byCapability[caps[i]];
            // Only re-sort if configId is in this array
            bool found = false;
            for (uint256 j = 0; j < arr.length; j++) {
                if (arr[j] == configId) { found = true; break; }
            }
            if (found) _sortByElo(arr);
        }
    }

    // Insertion sort descending by Elo (best agent first).
    function _sortByElo(uint256[] storage arr) internal {
        uint256 n = arr.length;
        for (uint256 i = 1; i < n; i++) {
            uint256 key = arr[i];
            uint256 keyElo = agents[key].eloScore;
            int256 j = int256(i) - 1;
            while (j >= 0 && agents[arr[uint256(j)]].eloScore < keyElo) {
                // j+1 is safe: j >= 0 → j+1 >= 1 > 0, no overflow as int256
                arr[uint256(j + 1)] = arr[uint256(j)];
                j--;
            }
            // j+1 is safe: exits when j == -1, so j+1 == 0; or j >= 0 and loop ended normally
            arr[uint256(j + 1)] = key;
        }
    }

    // ─── Validation helpers ───────────────────────────────────────────────────

    function _validateCaps(bytes32[] calldata caps) internal view {
        for (uint256 i = 0; i < caps.length; i++) {
            require(capabilities[caps[i]].id != bytes32(0), "unknown capability");
        }
    }

    function _validateExternalCaps(bytes32[] calldata caps) internal view {
        for (uint256 i = 0; i < caps.length; i++) {
            Capability memory c = capabilities[caps[i]];
            require(c.id != bytes32(0), "unknown capability");
            require(!c.nativeOnly && c.minTrustTier == 0, "cap restricted");
        }
    }

    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory result = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x41 && c <= 0x5a) result[i] = bytes1(uint8(c) + 32);
            else result[i] = c;
        }
        return string(result);
    }
}
