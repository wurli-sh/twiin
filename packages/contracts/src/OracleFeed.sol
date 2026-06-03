// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Step} from "./TwiinTypes.sol";

// Consensus oracle feed store. Any contract can read via getFeed / isStale.
// Refresh scheduling lives in AgentOrchestrator (not here).
// Events are indexing/UI signals only — not on-chain triggers.
contract OracleFeed {
    uint256 public constant MAX_STEPS = 8;

    struct Feed {
        string  value;
        uint8   confidence;       // 0–100
        uint256 timestamp;
        uint256 maxAgeSeconds;    // 0 = no TTL (isStale always false)
        uint256 refreshInterval;  // 0 = no auto-refresh
        bytes32 taskTemplateHash;
    }

    address public immutable deployer;
    address public           orchestrator;  // one-shot setter

    // personalAgentId → topicHash → Feed
    mapping(uint256 => mapping(bytes32 => Feed)) public feeds;

    // On-chain task templates so Reactivity callbacks can reconstruct refresh tasks.
    mapping(bytes32 => Step[])   public taskTemplates;
    mapping(bytes32 => uint256)  public taskTemplateBudget;
    mapping(bytes32 => bool)     public taskTemplateRegistered;

    event FeedPublished(uint256 indexed agentId, string topic, string value, uint8 confidence, uint256 timestamp);
    event RefreshSubscriptionRequested(uint256 indexed agentId, string topic, uint256 refreshInterval, bytes32 taskTemplateHash);
    event RefreshSubscriptionCancelled(uint256 indexed agentId, string topic);
    event TemplateRegistered(bytes32 indexed hash, uint256 stepCount, uint256 budgetWei);
    event OrchestratorSet(address indexed orchestrator);

    modifier onlyOrchestrator() {
        require(msg.sender == orchestrator, "only orchestrator");
        _;
    }

    constructor() {
        deployer = msg.sender;
    }

    function setOrchestrator(address _orchestrator) external {
        require(msg.sender == deployer, "only deployer");
        require(orchestrator == address(0), "set once");
        require(_orchestrator != address(0), "zero addr");
        orchestrator = _orchestrator;
        emit OrchestratorSet(_orchestrator);
    }

    // ─── Template management ─────────────────────────────────────────────────

    function registerTemplate(Step[] calldata steps, uint256 budgetWei)
        external onlyOrchestrator returns (bytes32 hash)
    {
        require(steps.length > 0 && steps.length <= MAX_STEPS, "bad step count");
        require(budgetWei > 0, "no budget");
        hash = keccak256(abi.encode(steps, budgetWei));
        if (!taskTemplateRegistered[hash]) {
            for (uint256 i = 0; i < steps.length; i++) {
                taskTemplates[hash].push(steps[i]);
            }
            taskTemplateBudget[hash] = budgetWei;
            taskTemplateRegistered[hash] = true;
            emit TemplateRegistered(hash, steps.length, budgetWei);
        }
    }

    // Returns the full Step[] array (public mapping returns single elements).
    function getTemplate(bytes32 hash) external view returns (Step[] memory) {
        require(taskTemplateRegistered[hash], "template not registered");
        return taskTemplates[hash];
    }

    // ─── Feed publishing ──────────────────────────────────────────────────────

    function publishFeed(
        uint256 agentId,
        string calldata topic,
        string calldata value,
        uint8 confidence,
        uint256 maxAgeSeconds,
        uint256 refreshInterval,
        bytes32 taskTemplateHash
    ) external onlyOrchestrator {
        require(confidence <= 100, "confidence out of range");
        require(bytes(topic).length > 0 && bytes(topic).length <= 64, "bad topic length");
        require(bytes(value).length <= 1024, "value too large");
        // Refresh must be no slower than TTL (otherwise feed is stale most of the time).
        require(
            refreshInterval == 0 || (maxAgeSeconds > 0 && refreshInterval <= maxAgeSeconds),
            "refresh > maxAge"
        );
        if (refreshInterval > 0) {
            require(taskTemplateRegistered[taskTemplateHash], "template not registered");
        }

        bytes32 topicKey = keccak256(bytes(topic));
        Feed storage prev = feeds[agentId][topicKey];

        // Detect subscription config change for dedup event (R2-25).
        bool subscriptionChanged =
            refreshInterval != prev.refreshInterval ||
            taskTemplateHash != prev.taskTemplateHash;
        uint256 prevRefreshInterval = prev.refreshInterval;

        feeds[agentId][topicKey] = Feed({
            value: value,
            confidence: confidence,
            timestamp: block.timestamp,
            maxAgeSeconds: maxAgeSeconds,
            refreshInterval: refreshInterval,
            taskTemplateHash: taskTemplateHash
        });

        emit FeedPublished(agentId, topic, value, confidence, block.timestamp);

        if (refreshInterval > 0 && subscriptionChanged) {
            emit RefreshSubscriptionRequested(agentId, topic, refreshInterval, taskTemplateHash);
        } else if (refreshInterval == 0 && prevRefreshInterval > 0) {
            emit RefreshSubscriptionCancelled(agentId, topic);
        }
    }

    // ─── Consumers ───────────────────────────────────────────────────────────

    function isStale(uint256 agentId, string calldata topic) external view returns (bool) {
        Feed storage f = feeds[agentId][keccak256(bytes(topic))];
        if (f.maxAgeSeconds == 0) return false;
        return block.timestamp - f.timestamp > f.maxAgeSeconds;
    }

    function getFeed(uint256 agentId, string calldata topic)
        external view
        returns (string memory value, uint8 confidence, uint256 timestamp, bool stale)
    {
        Feed storage f = feeds[agentId][keccak256(bytes(topic))];
        bool _stale = f.maxAgeSeconds > 0 && block.timestamp - f.timestamp > f.maxAgeSeconds;
        return (f.value, f.confidence, f.timestamp, _stale);
    }
}
