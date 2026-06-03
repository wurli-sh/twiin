// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IAgentRequesterHandler, IAgentRequester, Response, ResponseStatus, Request} from "./interfaces/IAgentRequesterHandler.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {AgentVault} from "./AgentVault.sol";
import {AgentPolicy} from "./AgentPolicy.sol";
import {OracleFeed} from "./OracleFeed.sol";
import {TwiinAccount} from "./TwiinAccount.sol";
import {
    AgentLane, PlanMode, StepState, TaskState, Step
} from "./TwiinTypes.sol";

// The orchestration engine: task lifecycle, agent dispatch, external result verification,
// oracle feed publishing, and chain-side Reactivity refresh scheduling.
contract AgentOrchestrator is
    IAgentRequesterHandler,
    SomniaEventHandler,
    ReentrancyGuard
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MIN_QUALITY_SCORE        = 40;
    uint64  public constant RATING_WINDOW            = 600;    // 10 min
    uint8   public constant TIMEOUT_RELEASE_SCORE    = 50;     // neutral Elo
    uint8   public constant MAX_RETRIES              = 2;
    uint256 public constant MAX_STEPS                = 8;
    uint64  public constant TASK_DEADLINE            = 1800;   // 30 min
    uint256 public constant MAX_EXTERNAL_RESULT_SIZE = 16_384; // 16 KB
    uint256 public constant SUBCOMMITTEE_SIZE        = 3;

    bytes32 public constant CAP_ONCHAIN_EXECUTE = keccak256("onchain.execute");

    // ERC-6551 salt — matches TWIIN_6551_SALT in shared/constants.ts
    bytes32 public constant TWIIN_6551_SALT = bytes32(0);

    // Refresh subscription options: 2M gas, no fee constraints.
    uint64 private constant REFRESH_GAS_LIMIT = 2_000_000;

    // ─── Immutable references (set in constructor) ────────────────────────────

    IERC6551Registry public immutable registry6551;
    address          public immutable twiinAccountImpl;
    address          public immutable twiinAgent;
    AgentRegistry    public immutable agentRegistry;
    AgentVault       public immutable vault;
    AgentPolicy      public immutable policy;
    OracleFeed       public immutable oracleFeed;
    IAgentRequester  public immutable agentsApi;
    address          public immutable keeper;
    address          public immutable admin;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TaskCreated(uint256 indexed taskId, uint256 indexed personalAgentId, PlanMode mode, uint256 budgetWei);
    event TaskCompleted(uint256 indexed taskId, string result);
    event TaskAborted(uint256 indexed taskId, string reason);
    event StepStateChanged(uint256 indexed taskId, uint8 stepIdx, StepState state);
    event ExternalAgentRequest(uint256 indexed taskId, uint8 stepIdx, uint256 configId, address registrant, bytes32 endpointHash, bytes payload, bytes32 reqId, uint64 deadline);
    event ExternalResultPending(uint256 indexed taskId, uint8 stepIdx, address registrant, bytes result);
    event ExternalStepApproved(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score);
    event ExternalStepRejected(uint256 indexed taskId, uint8 stepIdx, address registrant, uint8 score);
    event RatingTimedOut(uint256 indexed taskId, uint8 stepIdx);
    event NativeStepTimedOut(uint256 indexed taskId, uint8 stepIdx);
    event RefreshSkipped(uint256 indexed personalAgentId, string topic, string reason);
    event RefreshScheduled(uint256 indexed personalAgentId, string topic, uint256 timestampMillis, uint256 subscriptionId);

    // ─── State ────────────────────────────────────────────────────────────────

    struct StepRuntime {
        StepState state;
        uint256   somniaRequestId;
        bytes32   externalRequestId;
        uint256   externalConfigId;
        address   externalRegistrant;
        uint256   externalPayoutWei;
        uint64    deadline;
        bytes     resultData;
        uint8     retryCount;
    }

    struct Task {
        PlanMode  mode;
        uint256   personalAgentId;
        Step[]    steps;
        StepRuntime[] runtime;
        uint8     cursor;
        uint256   budgetWei;
        uint256   spentWei;
        uint64    deadline;
        TaskState state;
    }

    struct NativeRef { uint256 taskId; uint8 stepIdx; }

    // Refresh entry stored per-timestamp for _onEvent lookup.
    struct RefreshEntry {
        uint256 personalAgentId;
        string topic;
        bytes32 templateHash;
        uint256 nonce;
    }

    mapping(uint256 => uint256) public taskLock;   // personalAgentId → activeTaskId; 0 = free
    mapping(uint256 => Task)    public tasks;
    uint256                     public nextTaskId;  // starts at 1

    mapping(uint256 => NativeRef) internal nativeReqIndex;   // somniaRequestId → (taskId, stepIdx)
    mapping(uint256 => RefreshEntry[]) internal _scheduledRefreshes; // timestampMillis → entries
    mapping(bytes32 => uint256) internal _refreshNonceByTopic; // agent/topic key → latest nonce

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAgentsApi() {
        require(msg.sender == address(agentsApi), "only agents api");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "only keeper");
        _;
    }

    constructor(
        address _registry6551,
        address _twiinAccountImpl,
        address _twiinAgent,
        address _agentRegistry,
        address _vault,
        address _policy,
        address _oracleFeed,
        address _agentsApi,
        address _keeper,
        address _admin
    ) {
        registry6551      = IERC6551Registry(_registry6551);
        twiinAccountImpl  = _twiinAccountImpl;
        twiinAgent        = _twiinAgent;
        agentRegistry     = AgentRegistry(_agentRegistry);
        vault             = AgentVault(_vault);
        policy            = AgentPolicy(_policy);
        oracleFeed        = OracleFeed(_oracleFeed);
        agentsApi         = IAgentRequester(_agentsApi);
        keeper            = _keeper;
        admin             = _admin;
    }

    receive() external payable {}

    // ─── Task creation ────────────────────────────────────────────────────────

    // External entrypoint — agent-only auth.
    // User signs: twiinAccount.execute(orchestrator, budget, abi.encodeCall(createTask,...), 0)
    // The 6551 account forwards the budget as msg.value.
    function createTask(
        uint256 personalAgentId,
        Step[] calldata steps,
        uint256 budgetWei,
        PlanMode mode
    ) external payable returns (uint256 taskId) {
        address expectedAgent = _twiinAccount(personalAgentId);
        require(_agentExists(personalAgentId), "no agent");
        require(msg.sender == expectedAgent, "not agent");
        require(msg.value == budgetWei, "value != budgetWei");
        Step[] memory mSteps = new Step[](steps.length);
        for (uint256 i = 0; i < steps.length; i++) mSteps[i] = steps[i];
        return _createTaskInternal(personalAgentId, mSteps, budgetWei, mode);
    }

    function _createTaskInternal(
        uint256 personalAgentId,
        Step[] memory steps,
        uint256 budgetWei,
        PlanMode mode
    ) internal returns (uint256 taskId) {
        require(taskLock[personalAgentId] == 0, "task already active");
        require(steps.length > 0 && steps.length <= MAX_STEPS, "bad step count");
        require(budgetWei > 0, "no budget");

        // Reserve per-task + daily caps BEFORE touching vault (cheap revert on cap exceeded).
        policy.validateAndReserveTaskBudget(mode, personalAgentId, budgetWei);

        taskId = ++nextTaskId;
        taskLock[personalAgentId] = taskId;

        Task storage t = tasks[taskId];
        t.mode            = mode;
        t.personalAgentId = personalAgentId;
        t.budgetWei       = budgetWei;
        t.deadline        = uint64(block.timestamp + TASK_DEADLINE);
        t.state           = TaskState.Running;
        for (uint256 i = 0; i < steps.length; i++) {
            t.steps.push(steps[i]);
            t.runtime.push();
        }

        // Lock the full budget once. Funds arrive as address(this).balance via msg.value.
        vault.lockStep{value: budgetWei}(personalAgentId, taskId, budgetWei);

        emit TaskCreated(taskId, personalAgentId, mode, budgetWei);
        _dispatchStep(taskId);
    }

    // ─── Step dispatch ────────────────────────────────────────────────────────

    function _dispatchStep(uint256 taskId) internal {
        uint8 cursor = tasks[taskId].cursor;
        Step memory step = tasks[taskId].steps[cursor];
        AgentRegistry.SubAgent memory a = agentRegistry.get(step.subAgentConfigId);

        uint256 personalAgentId = tasks[taskId].personalAgentId;
        policy.requireNotKilled(personalAgentId);

        // Deposit formula: ops reserve + (costWei × subcommittee)
        uint256 stepCost = a.lane == AgentLane.SomniaNative
            ? agentsApi.getRequestDeposit() + (a.costWei * SUBCOMMITTEE_SIZE)
            : a.costWei;

        require(stepCost <= step.maxCostWei, "deposit exceeds maxCostWei");
        require(
            tasks[taskId].spentWei + stepCost <= tasks[taskId].budgetWei,
            "budget exhausted"
        );

        // Iterate ALL capabilities to check onchain.execute allowlist (not just slot 0).
        for (uint256 i = 0; i < a.capabilities.length; i++) {
            if (a.capabilities[i] == CAP_ONCHAIN_EXECUTE) {
                (address target,) = abi.decode(step.payload, (address, bytes));
                policy.requireAllowed(personalAgentId, target);
                break;
            }
        }

        if (a.lane == AgentLane.SomniaNative) {
            tasks[taskId].spentWei += stepCost;
            vault.payNative(taskId, stepCost);

            uint256 reqId = agentsApi.createRequest{value: stepCost}(
                a.somniaAgentId,
                address(this),
                this.handleResponse.selector,
                step.payload
            );
            StepRuntime storage rtN = tasks[taskId].runtime[cursor];
            rtN.state            = StepState.RunningNative;
            rtN.deadline         = uint64(block.timestamp + step.timeoutSeconds);
            rtN.somniaRequestId  = reqId;
            nativeReqIndex[reqId] = NativeRef({taskId: taskId, stepIdx: cursor});
        } else {
            // External: cost stays in taskLockedAmount until finalize/timeout.
            bytes32 reqId = keccak256(abi.encode(taskId, cursor, block.prevrandao, block.timestamp));
            StepRuntime storage rt = tasks[taskId].runtime[cursor];
            rt.externalRequestId = reqId;
            rt.externalConfigId  = step.subAgentConfigId;
            rt.externalRegistrant = a.registrant;
            rt.externalPayoutWei = a.costWei;
            rt.deadline          = uint64(block.timestamp + step.timeoutSeconds);
            rt.state             = StepState.RunningExternal;
            agentRegistry.incrementActiveStep(step.subAgentConfigId);
            emit ExternalAgentRequest(
                taskId, cursor, step.subAgentConfigId, a.registrant,
                a.endpointHash, step.payload, reqId, rt.deadline
            );
        }
        emit StepStateChanged(taskId, cursor, tasks[taskId].runtime[cursor].state);
    }

    // ─── Native callback ──────────────────────────────────────────────────────

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external onlyAgentsApi {
        NativeRef memory ref = nativeReqIndex[requestId];
        if (ref.taskId == 0) return;  // unknown or already cleaned up
        if (tasks[ref.taskId].state != TaskState.Running) {
            delete nativeReqIndex[requestId];
            return;
        }
        StepRuntime storage rt = tasks[ref.taskId].runtime[ref.stepIdx];
        if (rt.state != StepState.RunningNative) return;  // ignore late callbacks

        delete nativeReqIndex[requestId];  // storage hygiene

        bool success = status == ResponseStatus.Success && responses.length > 0;
        bytes memory result = success ? responses[0].result : bytes("");
        rt.state      = success ? StepState.Succeeded : StepState.Failed;
        rt.resultData = result;

        uint256 cfg = tasks[ref.taskId].steps[ref.stepIdx].subAgentConfigId;
        if (success) agentRegistry.recordSuccess(cfg, 0, 100);
        else         agentRegistry.recordFailure(cfg, false);

        _advance(ref.taskId, ref.stepIdx, success, result);
    }

    // ─── External result submission ────────────────────────────────────────────

    // Permissionless relay — ECDSA-verified. Result held pending rating (no payment yet).
    function submitExternalResult(
        uint256 taskId,
        uint8 stepIdx,
        bytes calldata result,
        bytes calldata signature
    ) external nonReentrant {
        require(result.length <= MAX_EXTERNAL_RESULT_SIZE, "result too large");
        require(tasks[taskId].state == TaskState.Running, "task not running");
        require(stepIdx < tasks[taskId].runtime.length, "step out of range");
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        require(rt.state == StepState.RunningExternal, "not awaiting");
        require(block.timestamp <= rt.deadline, "expired");
        require(rt.externalRegistrant != address(0), "no registrant");

        // EIP-191 + chain-id bound + replay-proof (reqId binds prevrandao).
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Twiin External Result v1\n",
            block.chainid,
            address(this),
            taskId,
            stepIdx,
            rt.externalRequestId,
            keccak256(result)
        ));
        address recovered = digest.toEthSignedMessageHash().recover(signature);
        require(recovered != address(0) && recovered == rt.externalRegistrant, "bad sig");

        // CEI: mutate state before side effects.
        rt.resultData = result;
        rt.state      = StepState.AwaitingRating;
        rt.deadline   = uint64(block.timestamp + RATING_WINDOW);

        emit ExternalResultPending(taskId, stepIdx, rt.externalRegistrant, result);
        emit StepStateChanged(taskId, stepIdx, StepState.AwaitingRating);
    }

    // ─── Rating ───────────────────────────────────────────────────────────────

    // Keeper rates within RATING_WINDOW. Score ≥ 40 gates payment.
    function finalizeExternalStep(
        uint256 taskId,
        uint8 stepIdx,
        uint8 score
    ) external onlyKeeper nonReentrant {
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        require(rt.state == StepState.AwaitingRating, "not pending rating");

        uint256 configId = rt.externalConfigId;

        if (score >= MIN_QUALITY_SCORE) {
            rt.state = StepState.Succeeded;                        // CEI
            agentRegistry.decrementActiveStep(configId);
            vault.releaseExternal(taskId, stepIdx, payable(rt.externalRegistrant), rt.externalPayoutWei);
            tasks[taskId].spentWei += rt.externalPayoutWei;
            agentRegistry.recordSuccess(configId, 0, score);
            emit ExternalStepApproved(taskId, stepIdx, rt.externalRegistrant, score);
            _advance(taskId, stepIdx, true, rt.resultData);
        } else {
            rt.state = StepState.Failed;                           // CEI
            agentRegistry.decrementActiveStep(configId);
            agentRegistry.recordFailure(configId, true);
            emit ExternalStepRejected(taskId, stepIdx, rt.externalRegistrant, score);
            _advance(taskId, stepIdx, false, bytes(""));
        }
    }

    // Permissionless auto-release after RATING_WINDOW (benefit of doubt for keeper absence).
    function timeoutRating(uint256 taskId, uint8 stepIdx) external nonReentrant {
        require(tasks[taskId].state == TaskState.Running, "task not running");
        require(stepIdx < tasks[taskId].runtime.length, "step out of range");
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        require(
            rt.state == StepState.AwaitingRating && block.timestamp >= rt.deadline,
            "not timed out"
        );
        uint256 configId = rt.externalConfigId;

        rt.state = StepState.Succeeded;                            // CEI
        agentRegistry.decrementActiveStep(configId);
        vault.releaseExternal(taskId, stepIdx, payable(rt.externalRegistrant), rt.externalPayoutWei);
        tasks[taskId].spentWei += rt.externalPayoutWei;
        agentRegistry.recordSuccess(configId, 0, TIMEOUT_RELEASE_SCORE);
        emit RatingTimedOut(taskId, stepIdx);
        _advance(taskId, stepIdx, true, rt.resultData);
    }

    // ─── Timeouts ─────────────────────────────────────────────────────────────

    // External agent never responded.
    function timeoutExternalStep(uint256 taskId, uint8 stepIdx) external nonReentrant {
        require(tasks[taskId].state == TaskState.Running, "task not running");
        require(stepIdx < tasks[taskId].runtime.length, "step out of range");
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        require(
            rt.state == StepState.RunningExternal && block.timestamp >= rt.deadline,
            "not timed out"
        );
        uint256 configId = rt.externalConfigId;

        rt.state = StepState.TimedOut;                             // CEI
        agentRegistry.decrementActiveStep(configId);
        agentRegistry.recordFailure(configId, true);
        _advance(taskId, stepIdx, false, bytes(""));
    }

    // Native validators never produced a callback.
    function timeoutNativeStep(uint256 taskId, uint8 stepIdx) external nonReentrant {
        require(tasks[taskId].state == TaskState.Running, "task not running");
        require(stepIdx < tasks[taskId].runtime.length, "step out of range");
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        require(
            rt.state == StepState.RunningNative && block.timestamp >= rt.deadline,
            "not timed out"
        );
        uint256 configId = tasks[taskId].steps[stepIdx].subAgentConfigId;

        rt.state = StepState.TimedOut;                             // CEI
        delete nativeReqIndex[rt.somniaRequestId];                 // clear late-callback route
        agentRegistry.recordFailure(configId, false);
        emit NativeStepTimedOut(taskId, stepIdx);
        _advance(taskId, stepIdx, false, bytes(""));
    }

    // Permissionless task-level reaper (30 min deadline).
    function timeoutTask(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.Running, "not running");
        require(block.timestamp >= t.deadline, "not timed out");
        _abortTask(taskId, "task timed out");
    }

    // ─── Task state machine ───────────────────────────────────────────────────

    // completeTask: sweep unused budget back to 6551 account, credit daily cap, release lock.
    function _completeTask(uint256 taskId, string memory result) internal {
        Task storage t = tasks[taskId];
        uint256 unused = vault.taskLockedAmount(taskId);
        if (unused > 0) {
            vault.sweepTaskRemainder(taskId, payable(_twiinAccount(t.personalAgentId)), unused);
            policy.releaseUnusedBudget(t.personalAgentId, unused);
        }
        taskLock[t.personalAgentId] = 0;
        t.state = TaskState.Completed;
        emit TaskCompleted(taskId, result);
    }

    // _abortTask: decrement active counters for in-flight external steps, sweep, release lock.
    function _abortTask(uint256 taskId, string memory reason) internal {
        Task storage t = tasks[taskId];
        uint8 c = t.cursor;
        if (c < t.runtime.length) {
            StepRuntime storage rt = t.runtime[c];
            if (rt.state == StepState.RunningNative) {
                delete nativeReqIndex[rt.somniaRequestId];
                rt.state = StepState.Failed;
            }
            if (rt.state == StepState.RunningExternal || rt.state == StepState.AwaitingRating) {
                agentRegistry.decrementActiveStep(t.steps[c].subAgentConfigId);
                rt.state = StepState.Failed;
            }
        }
        uint256 unused = vault.taskLockedAmount(taskId);
        if (unused > 0) {
            vault.sweepTaskRemainder(taskId, payable(_twiinAccount(t.personalAgentId)), unused);
            policy.releaseUnusedBudget(t.personalAgentId, unused);
        }
        taskLock[t.personalAgentId] = 0;
        t.state = TaskState.Aborted;
        emit TaskAborted(taskId, reason);
    }

    // _advance: state machine transition after a step settles.
    function _advance(uint256 taskId, uint8 stepIdx, bool success, bytes memory result) internal {
        Task storage t = tasks[taskId];
        if (t.state != TaskState.Running) return;
        if (stepIdx != t.cursor) return;  // stale callback — ignore

        if (success) {
            t.cursor++;
            if (t.cursor == t.steps.length) {
                // All steps done.
                _completeTask(taskId, string(result));
            } else {
                _dispatchStep(taskId);
            }
        } else {
            StepRuntime storage rt = t.runtime[stepIdx];
            if (rt.state == StepState.TimedOut) {
                // Timed-out steps don't retry — latency was the symptom.
                _abortTask(taskId, "step timed out");
                return;
            }
            if (rt.retryCount < MAX_RETRIES) {
                rt.retryCount++;
                rt.state = StepState.Retrying;
                // Snapshot byCapability array at retry-start to avoid Elo-write mutations (R2-24).
                uint256[] memory snapshot = _snapshotByCapability(stepIdx, t);
                bool dispatched = _retryWithSnapshot(taskId, stepIdx, snapshot);
                if (!dispatched) _abortTask(taskId, "step failed");
            } else {
                _abortTask(taskId, "step failed");
            }
        }
    }

    // Take a snapshot of byCapability for the first capability of the failing step.
    function _snapshotByCapability(
        uint8 stepIdx,
        Task storage t
    ) internal view returns (uint256[] memory) {
        AgentRegistry.SubAgent memory a = agentRegistry.get(t.steps[stepIdx].subAgentConfigId);
        if (a.capabilities.length == 0) return new uint256[](0);
        return agentRegistry.getByCapability(a.capabilities[0]);
    }

    // Try the next-ranked agent from the snapshot for the current step.
    function _retryWithSnapshot(
        uint256 taskId,
        uint8 stepIdx,
        uint256[] memory snapshot
    ) internal returns (bool) {
        uint256 currentConfigId = tasks[taskId].steps[stepIdx].subAgentConfigId;
        for (uint256 i = 0; i < snapshot.length; i++) {
            if (snapshot[i] == currentConfigId) continue;
            AgentRegistry.SubAgent memory candidate = agentRegistry.get(snapshot[i]);
            if (!candidate.isActive || candidate.suspended) continue;
            tasks[taskId].steps[stepIdx].subAgentConfigId = snapshot[i];
            _dispatchStep(taskId);
            return true;
        }
        return false;
    }

    // ─── Oracle feed + refresh scheduling ────────────────────────────────────

    function publishFeedAndMaybeSchedule(
        uint256 personalAgentId,
        string calldata topic,
        string calldata value,
        uint8 confidence,
        uint256 maxAgeSeconds,
        uint256 refreshInterval,
        bytes32 templateHash
    ) external {
        require(msg.sender == address(this) || msg.sender == admin, "not allowed");
        _publishFeedAndMaybeSchedule(
            personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash
        );
    }

    function _publishFeedAndMaybeSchedule(
        uint256 personalAgentId,
        string memory topic,
        string memory value,
        uint8 confidence,
        uint256 maxAgeSeconds,
        uint256 refreshInterval,
        bytes32 templateHash
    ) internal {
        bytes32 topicKey = keccak256(abi.encode(personalAgentId, topic));
        ++_refreshNonceByTopic[topicKey];
        oracleFeed.publishFeed(
            personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash
        );
        if (refreshInterval > 0) {
            _scheduleOrUpdateRefresh(personalAgentId, topic, refreshInterval, templateHash);
        }
    }

    function _scheduleOrUpdateRefresh(
        uint256 personalAgentId,
        string memory topic,
        uint256 refreshInterval,
        bytes32 templateHash
    ) internal {
        bytes32 topicKey = keccak256(abi.encode(personalAgentId, topic));
        uint256 nonce = _refreshNonceByTopic[topicKey];
        uint256 timestampMillis = (block.timestamp + refreshInterval) * 1000;

        // Store the entry so _onEvent can look it up by timestamp.
        _scheduledRefreshes[timestampMillis].push(RefreshEntry({
            personalAgentId: personalAgentId,
            topic: topic,
            templateHash: templateHash,
            nonce: nonce
        }));

        // Try scheduling via Somnia Reactivity precompile (fails gracefully on Hardhat / low balance).
        // We use an external self-call so try/catch works on the library internal.
        try this.scheduleSubscriptionSelfCall(personalAgentId, topic, timestampMillis)
            returns (uint256 subscriptionId)
        {
            emit RefreshScheduled(personalAgentId, topic, timestampMillis, subscriptionId);
        } catch {
            // Subscription failed (no precompile in Hardhat, balance < 32 STT, etc.).
            // Refresh still works via the keeper fallback path.
        }
    }

    // External self-call wrapper so _scheduleOrUpdateRefresh can try/catch the library call.
    function scheduleSubscriptionSelfCall(
        uint256 /*personalAgentId*/,
        string calldata /*topic*/,
        uint256 timestampMillis
    ) external returns (uint256 subscriptionId) {
        require(msg.sender == address(this), "only self");
        SomniaExtensions.SubscriptionOptions memory opts = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: 0,
            maxFeePerGas: 0,
            gasLimit: REFRESH_GAS_LIMIT
        });
        return SomniaExtensions.scheduleSubscriptionAtTimestamp(address(this), timestampMillis, opts);
    }

    // Reactivity callback — only reachable from precompile 0x0100 (enforced by SomniaEventHandler base).
    function _onEvent(
        address /* emitter */,
        bytes32[] calldata eventTopics,
        bytes calldata /* data */  // empty for Schedule events
    ) internal override {
        // eventTopics[1] = bytes32(timestampMillis) from the Schedule event.
        if (eventTopics.length < 2) return;
        uint256 timestampMillis = uint256(eventTopics[1]);

        RefreshEntry[] storage entries = _scheduledRefreshes[timestampMillis];
        for (uint256 i = 0; i < entries.length; i++) {
            if (!_isRefreshEntryCurrent(entries[i])) continue;
            _refreshFromTemplate(
                entries[i].personalAgentId,
                entries[i].topic,
                entries[i].templateHash
            );
        }
        delete _scheduledRefreshes[timestampMillis];  // storage cleanup
    }

    // ─── Refresh execution ────────────────────────────────────────────────────

    function _refreshFromTemplate(
        uint256 personalAgentId,
        string memory topic,
        bytes32 templateHash
    ) internal {
        if (policy.isKilled(personalAgentId)) {
            emit RefreshSkipped(personalAgentId, topic, "kill switch");
            return;
        }
        if (taskLock[personalAgentId] != 0) {
            emit RefreshSkipped(personalAgentId, topic, "task in flight");
            return;
        }
        // Guard before getTemplate — it reverts on unknown hash; emit event instead.
        if (!oracleFeed.taskTemplateRegistered(templateHash)) {
            emit RefreshSkipped(personalAgentId, topic, "task preflight");
            return;
        }
        Step[] memory steps = oracleFeed.getTemplate(templateHash);
        uint256 budget = oracleFeed.taskTemplateBudget(templateHash);
        if (!_preflightRefreshTask(personalAgentId, steps, budget)) {
            emit RefreshSkipped(personalAgentId, topic, "task preflight");
            return;
        }

        address payable acct = payable(_twiinAccount(personalAgentId));
        try TwiinAccount(acct).pullForRefresh(address(this), budget) {
            try this.createRefreshTaskFromPulledFunds(personalAgentId, steps, budget) {
                // ok
            } catch {
                // Refund pulled STT back to the 6551 account on create failure.
                (bool ok, ) = acct.call{value: budget}("");
                require(ok, "refund failed");  // should never fail since acct has receive()
                emit RefreshSkipped(personalAgentId, topic, "task create");
            }
        } catch {
            emit RefreshSkipped(personalAgentId, topic, "refresh allowance");
        }
    }

    // Only callable by this contract (catchable self-call from _refreshFromTemplate).
    function createRefreshTaskFromPulledFunds(
        uint256 personalAgentId,
        Step[] calldata steps,
        uint256 budget
    ) external returns (uint256 taskId) {
        require(msg.sender == address(this), "only self");
        return _createTaskInternal(personalAgentId, steps, budget, PlanMode.ClaudePlan);
    }

    // Degraded-mode keeper fallback — uses same 6551 pull allowance, never calls external createTask.
    function refreshFromTemplateByKeeper(
        uint256 personalAgentId,
        string calldata topic,
        bytes32 templateHash
    ) external onlyKeeper {
        _refreshFromTemplate(personalAgentId, topic, templateHash);
    }

    // Mirrors create/dispatch failure conditions without mutating state.
    function _preflightRefreshTask(
        uint256 personalAgentId,
        Step[] memory steps,
        uint256 budget
    ) internal view returns (bool) {
        if (taskLock[personalAgentId] != 0) return false;
        if (steps.length == 0 || steps.length > MAX_STEPS) return false;
        if (budget == 0) return false;
        if (!policy.canReserveTaskBudget(PlanMode.ClaudePlan, personalAgentId, budget)) return false;
        return true;
    }

    function _isRefreshEntryCurrent(RefreshEntry storage entry) internal view returns (bool) {
        bytes32 topicKey = keccak256(abi.encode(entry.personalAgentId, entry.topic));
        return _refreshNonceByTopic[topicKey] == entry.nonce;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _twiinAccount(uint256 personalAgentId) internal view returns (address) {
        return registry6551.account(
            twiinAccountImpl,
            TWIIN_6551_SALT,
            block.chainid,
            twiinAgent,
            personalAgentId
        );
    }

    function _agentExists(uint256 personalAgentId) internal view returns (bool) {
        (bool ok, bytes memory data) = twiinAgent.staticcall(
            abi.encodeWithSignature("ownerOf(uint256)", personalAgentId)
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (address)) != address(0);
    }
}
