// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {
    IAgentRequesterHandler,
    IAgentRequester,
    ResponseStatus,
    ResponseWire,
    RequestWire
} from "./interfaces/IAgentRequesterHandler.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {AgentVault} from "./AgentVault.sol";
import {AgentPolicy} from "./AgentPolicy.sol";
import {
    AgentLane, PlanMode, StepState, TaskState, TrustlessAwaiting, Step
} from "./TwiinTypes.sol";
import {AgentConsensusLib} from "./lib/AgentConsensusLib.sol";
import {AgentJaniceLib} from "./lib/AgentJaniceLib.sol";

// The orchestration engine: task lifecycle, agent dispatch, external result verification,
// and trustless Janice execution. Refresh scheduling is delegated to AgentRefreshCoordinator.
contract AgentOrchestrator is
    IAgentRequesterHandler,
    ReentrancyGuard
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Constants ────────────────────────────────────────────────────────────

    error OnlyAgentsApi();
    error OnlyKeeper();
    error NoAgent();
    error NotAgent();
    error ValueBudgetMismatch();
    error TaskAlreadyActive();
    error BadStepCount();
    error NoBudget();
    error NotTrustless();
    error TaskNotRunning();
    error NotAwaitingResume();
    error TaskTimedOut();
    error BadJaniceCost();
    error DepositExceedsMax();
    error BadToolPayload();
    error ResultTooLarge();
    error StepOutOfRange();
    error NotAwaitingExternal();
    error StepExpired();
    error NoRegistrant();
    error BadSignature();
    error NotPendingRating();
    error NotRunning();
    error NotTimedOut();
    error BudgetExhausted();
    error BadNativeConfig();
    error MaxStepsReached();
    error OnlyAdmin();
    error OnlyRefreshManager();
    error RefreshManagerAlreadySet();

    uint256 public constant MIN_QUALITY_SCORE        = 40;
    uint64  public constant RATING_WINDOW            = 600;    // 10 min
    uint8   public constant TIMEOUT_RELEASE_SCORE    = 50;     // neutral Elo
    uint8   public constant MAX_RETRIES              = 2;
    uint256 public constant MAX_STEPS                = 8;
    uint64  public constant TASK_DEADLINE            = 1800;   // 30 min
    uint256 public constant MAX_EXTERNAL_RESULT_SIZE = 16_384; // 16 KB
    uint256 public constant SUBCOMMITTEE_SIZE        = 3;
    uint8   public constant MAX_JANICE_ITERATIONS    = 8;
    uint8   public constant INFER_TOOLS_CHAT_MAX_ITERATIONS = 8;
    uint256 public constant JANICE_CONFIG_ID         = 0;
    uint256 private constant ANALYSIS_CONFIG_ID      = 3;
    uint256 private constant REPORTER_CONFIG_ID      = 4;

    bytes32 public constant CAP_ONCHAIN_EXECUTE = keccak256("onchain.execute");
    uint8   private constant RESPONSE_STATUS_SUCCESS = uint8(ResponseStatus.Success);
    bytes4  private constant SEL_FETCH_STRING = bytes4(keccak256("fetchString(string,string)"));
    bytes4  private constant SEL_FETCH_UINT = bytes4(keccak256("fetchUint(string,string,uint8)"));
    bytes4  private constant SEL_EXTRACT_STRING = bytes4(keccak256("ExtractString(string,string,string[],string,string,bool,uint8,uint8)"));
    bytes4  private constant SEL_EXTRACT_NUMBER = bytes4(keccak256("ExtractANumber(string,string,uint256,uint256,string,string,bool,uint8,uint8)"));
    bytes4  private constant SEL_INFER_STRING = bytes4(keccak256("inferString(string,string,bool,string[])"));
    bytes4  private constant SEL_INFER_NUMBER = bytes4(keccak256("inferNumber(string,string,int256,int256,bool)"));

    // ERC-6551 salt — matches TWIIN_6551_SALT in shared/constants.ts
    bytes32 public constant TWIIN_6551_SALT = bytes32(0);

    // ─── Immutable references (set in constructor) ────────────────────────────

    IERC6551Registry public immutable registry6551;
    address          public immutable twiinAccountImpl;
    address          public immutable twiinAgent;
    AgentRegistry    public immutable agentRegistry;
    AgentVault       public immutable vault;
    AgentPolicy      public immutable policy;
    IAgentRequester  public immutable agentsApi;
    address          public immutable keeper;
    address          public immutable admin;
    address          public refreshManager;

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
    event TrustlessTaskIntent(uint256 indexed taskId, string goal, bytes32 intentHash, uint8 maxIterations);
    event TrustlessStepAppended(
        uint256 indexed taskId,
        uint8 indexed stepIdx,
        uint256 configId,
        bytes payload,
        uint256 maxCostWei,
        uint64 timeoutSeconds
    );
    event JaniceIteration(
        uint256 indexed taskId,
        uint8 indexed iteration,
        uint256 requestId,
        string finishReason,
        bytes32 transcriptHash
    );
    event JaniceToolExecuted(
        uint256 indexed taskId,
        uint8 indexed iteration,
        string toolName,
        bytes32 argsHash,
        bool success
    );
    event JaniceResumeQueued(
        uint256 indexed taskId,
        uint8 indexed nextIteration,
        bytes32 transcriptHash,
        string reason
    );
    event StepConsensusReached(
        uint256 indexed taskId,
        uint8 indexed stepIdx,
        uint256 indexed requestId,
        uint64 validators,
        uint256 receiptId,
        uint256 medianExecutionCost
    );

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

    struct TrustlessCtx {
        uint256 janiceRequestId;
        uint8 iterations;
        uint8 maxIterations;
        TrustlessAwaiting awaiting;
        uint64 deadline;
        bytes32 intentHash;
    }

    mapping(uint256 => uint256) public taskLock;   // personalAgentId → activeTaskId; 0 = free
    mapping(uint256 => Task)    public tasks;
    uint256                     public nextTaskId;  // starts at 1

    mapping(uint256 => NativeRef) internal nativeReqIndex;   // somniaRequestId → (taskId, stepIdx)
    mapping(uint256 => uint256) internal trustlessReqIndex;  // janice requestId → taskId
    mapping(uint256 => TrustlessCtx) public trustlessCtx;
    mapping(uint256 => mapping(uint8 => AgentConsensusLib.Receipt)) public stepReceipts;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAgentsApi() {
        if (msg.sender != address(agentsApi)) revert OnlyAgentsApi();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    constructor(
        address _registry6551,
        address _twiinAccountImpl,
        address _twiinAgent,
        address _agentRegistry,
        address _vault,
        address _policy,
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
        if (!_agentExists(personalAgentId)) revert NoAgent();
        if (msg.sender != expectedAgent) revert NotAgent();
        if (msg.value != budgetWei) revert ValueBudgetMismatch();
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
        if (taskLock[personalAgentId] != 0) revert TaskAlreadyActive();
        if (steps.length == 0 || steps.length > MAX_STEPS) revert BadStepCount();
        if (budgetWei == 0) revert NoBudget();

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

    function createTrustlessTask(
        uint256 personalAgentId,
        bytes calldata intentPayload,
        uint256 budgetWei
    ) external payable returns (uint256 taskId) {
        address expectedAgent = _twiinAccount(personalAgentId);
        if (!_agentExists(personalAgentId)) revert NoAgent();
        if (msg.sender != expectedAgent) revert NotAgent();
        if (msg.value != budgetWei) revert ValueBudgetMismatch();
        if (taskLock[personalAgentId] != 0) revert TaskAlreadyActive();
        if (budgetWei == 0) revert NoBudget();

        string memory goal = abi.decode(intentPayload, (string));
        bytes32 intentHash = keccak256(intentPayload);

        policy.validateAndReserveTaskBudget(PlanMode.TrustlessJanice, personalAgentId, budgetWei);

        taskId = ++nextTaskId;
        taskLock[personalAgentId] = taskId;

        Task storage t = tasks[taskId];
        t.mode = PlanMode.TrustlessJanice;
        t.personalAgentId = personalAgentId;
        t.budgetWei = budgetWei;
        t.deadline = uint64(block.timestamp + TASK_DEADLINE);
        t.state = TaskState.Running;

        TrustlessCtx storage ctx = trustlessCtx[taskId];
        ctx.iterations = 0;
        ctx.maxIterations = MAX_JANICE_ITERATIONS;
        ctx.awaiting = TrustlessAwaiting.Janice;
        ctx.deadline = t.deadline;
        ctx.intentHash = intentHash;

        vault.lockStep{value: budgetWei}(personalAgentId, taskId, budgetWei);

        emit TaskCreated(taskId, personalAgentId, PlanMode.TrustlessJanice, budgetWei);
        emit TrustlessTaskIntent(taskId, goal, intentHash, ctx.maxIterations);

        bytes memory payload = AgentJaniceLib.buildInitialJanicePayload(goal, ctx.maxIterations);
        _startJaniceRequest(taskId, payload);
    }

    function resumeTrustlessTask(
        uint256 taskId,
        bytes calldata resumePayload,
        uint256 janiceCostWei
    ) external onlyKeeper nonReentrant {
        Task storage t = tasks[taskId];
        if (t.mode != PlanMode.TrustlessJanice) revert NotTrustless();
        if (t.state != TaskState.Running) revert TaskNotRunning();
        TrustlessCtx storage ctx = trustlessCtx[taskId];
        if (ctx.awaiting != TrustlessAwaiting.Resume) revert NotAwaitingResume();
        if (block.timestamp >= t.deadline) revert TaskTimedOut();

        uint256 expectedCost = _nativeRequestCost(JANICE_CONFIG_ID);
        if (janiceCostWei != expectedCost) revert BadJaniceCost();
        _startJaniceRequest(taskId, resumePayload);
    }

    function setRefreshManager(address _refreshManager) external {
        if (msg.sender != admin) revert OnlyAdmin();
        if (refreshManager != address(0)) revert RefreshManagerAlreadySet();
        refreshManager = _refreshManager;
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

        if (stepCost > step.maxCostWei) revert DepositExceedsMax();
        if (tasks[taskId].spentWei + stepCost > tasks[taskId].budgetWei) revert BudgetExhausted();

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
            bytes memory dispatchPayload = _payloadForDispatch(taskId, cursor, step);

            uint256 reqId = agentsApi.createRequest{value: stepCost}(
                a.somniaAgentId,
                address(this),
                this.handleResponse.selector,
                dispatchPayload
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
        ResponseWire[] memory responses,
        uint8 status,
        RequestWire memory details
    ) external onlyAgentsApi {
        uint256 trustlessTaskId = trustlessReqIndex[requestId];
        if (trustlessTaskId != 0) {
            _handleTrustlessResponse(trustlessTaskId, requestId, responses, status);
            return;
        }

        NativeRef memory ref = nativeReqIndex[requestId];
        if (ref.taskId == 0) return;  // unknown or already cleaned up
        if (tasks[ref.taskId].state != TaskState.Running) {
            delete nativeReqIndex[requestId];
            return;
        }
        StepRuntime storage rt = tasks[ref.taskId].runtime[ref.stepIdx];
        if (rt.state != StepState.RunningNative) return;  // ignore late callbacks

        delete nativeReqIndex[requestId];  // storage hygiene

        bool success = status == RESPONSE_STATUS_SUCCESS
            && AgentConsensusLib.satisfiesParticipation(responses, details);

        if (success) {
            AgentConsensusLib.Receipt memory receipt =
                AgentConsensusLib.buildReceipt(responses);
            stepReceipts[ref.taskId][ref.stepIdx] = receipt;
            emit StepConsensusReached(
                ref.taskId,
                ref.stepIdx,
                requestId,
                receipt.validators,
                receipt.receiptId,
                receipt.executionCost
            );
        }

        bytes memory result = success ? responses[0].result : bytes("");
        rt.state      = success ? StepState.Succeeded : StepState.Failed;
        rt.resultData = result;
        emit StepStateChanged(ref.taskId, ref.stepIdx, rt.state);

        uint256 cfg = tasks[ref.taskId].steps[ref.stepIdx].subAgentConfigId;
        if (success) agentRegistry.recordSuccess(cfg, 0, 100);
        else         agentRegistry.recordFailure(cfg, false);

        _advance(ref.taskId, ref.stepIdx, success, result);
    }

    /// @notice Consensus receipt for a completed native step (empty until callback lands).
    function stepConsensusOf(
        uint256 taskId,
        uint8 stepIdx
    ) external view returns (AgentConsensusLib.Receipt memory) {
        return stepReceipts[taskId][stepIdx];
    }

    function _payloadForDispatch(
        uint256 taskId,
        uint8 stepIdx,
        Step memory step
    ) internal view returns (bytes memory) {
        if (
            step.subAgentConfigId != ANALYSIS_CONFIG_ID &&
            step.subAgentConfigId != REPORTER_CONFIG_ID
        ) {
            return step.payload;
        }

        string memory priorContext = _priorStepContext(taskId, stepIdx);
        if (bytes(priorContext).length == 0) return step.payload;

        return _appendContextToLlmPayload(step.payload, priorContext);
    }

    function _priorStepContext(uint256 taskId, uint8 uptoStepIdx) internal view returns (string memory) {
        string memory context = "";
        for (uint8 i = 0; i < uptoStepIdx; i++) {
            bytes memory resultData = tasks[taskId].runtime[i].resultData;
            if (resultData.length == 0) continue;

            string memory decoded = _decodeStepResult(tasks[taskId].steps[i], resultData);
            if (bytes(decoded).length == 0) continue;

            string memory label = _stepOutputLabel(tasks[taskId].steps[i]);
            if (bytes(context).length == 0) {
                context = string.concat("Previous step outputs:\n- ", label, ": ", decoded);
            } else {
                context = string.concat(context, "\n- ", label, ": ", decoded);
            }
        }
        return context;
    }

    function _stepOutputLabel(Step memory step) internal pure returns (string memory) {
        if (step.subAgentConfigId == 1) return "web-intel";
        if (step.subAgentConfigId == ANALYSIS_CONFIG_ID) return "analysis";
        if (step.subAgentConfigId == REPORTER_CONFIG_ID) return "reporter";

        bytes4 selector = _selectorOf(step.payload);
        bytes memory argsData = _payloadArgs(step.payload);
        if (selector == SEL_FETCH_STRING) {
            (, string memory selectorText) = abi.decode(argsData, (string, string));
            return string.concat("oracle ", selectorText);
        }
        if (selector == SEL_FETCH_UINT) {
            (, string memory selectorText, uint8 decimals) = abi.decode(argsData, (string, string, uint8));
            return string.concat(
                "oracle ",
                selectorText,
                " (decimals=",
                _uintToString(uint256(decimals)),
                ")"
            );
        }
        return "prior result";
    }

    function _decodeStepResult(Step memory step, bytes memory resultData) internal pure returns (string memory) {
        bytes4 selector = _selectorOf(step.payload);
        bytes memory argsData = _payloadArgs(step.payload);

        if (selector == SEL_FETCH_STRING || selector == SEL_EXTRACT_STRING || selector == SEL_INFER_STRING) {
            return abi.decode(resultData, (string));
        }
        if (selector == SEL_FETCH_UINT || selector == SEL_EXTRACT_NUMBER) {
            uint256 value = abi.decode(resultData, (uint256));
            if (selector == SEL_FETCH_UINT) {
                (, , uint8 decimals) = abi.decode(argsData, (string, string, uint8));
                return _formatFixed(value, decimals);
            }
            return _uintToString(value);
        }
        if (selector == SEL_INFER_NUMBER) {
            // decode as signed number for analysis payloads that request numeric output
            return _intToString(abi.decode(resultData, (int256)));
        }

        // Fallback for plain ABI string outputs from future native LLM/web steps.
        if (step.subAgentConfigId == ANALYSIS_CONFIG_ID || step.subAgentConfigId == REPORTER_CONFIG_ID) {
            return abi.decode(resultData, (string));
        }

        return "";
    }

    function _appendContextToLlmPayload(
        bytes memory payload,
        string memory priorContext
    ) internal pure returns (bytes memory) {
        bytes4 selector = _selectorOf(payload);
        bytes memory argsData = _payloadArgs(payload);

        if (selector == SEL_INFER_STRING) {
            (
                string memory prompt,
                string memory system,
                bool chainOfThought,
                string[] memory allowedValues
            ) = abi.decode(argsData, (string, string, bool, string[]));
            return abi.encodeWithSelector(
                SEL_INFER_STRING,
                string.concat(prompt, "\n\n", priorContext),
                system,
                chainOfThought,
                allowedValues
            );
        }

        if (selector == SEL_INFER_NUMBER) {
            (
                string memory prompt,
                string memory system,
                int256 minValue,
                int256 maxValue,
                bool chainOfThought
            ) = abi.decode(argsData, (string, string, int256, int256, bool));
            return abi.encodeWithSelector(
                SEL_INFER_NUMBER,
                string.concat(prompt, "\n\n", priorContext),
                system,
                minValue,
                maxValue,
                chainOfThought
            );
        }

        return payload;
    }

    function _selectorOf(bytes memory payload) internal pure returns (bytes4 selector) {
        if (payload.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(payload, 32))
        }
    }

    function _payloadArgs(bytes memory payload) internal pure returns (bytes memory argsData) {
        if (payload.length <= 4) return "";
        argsData = new bytes(payload.length - 4);
        for (uint256 i = 0; i < argsData.length; i++) {
            argsData[i] = payload[i + 4];
        }
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 temp = value;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _intToString(int256 value) internal pure returns (string memory) {
        if (value >= 0) return _uintToString(uint256(value));
        return string.concat("-", _uintToString(uint256(-value)));
    }

    function _formatFixed(uint256 value, uint8 decimals) internal pure returns (string memory) {
        if (decimals == 0) return _uintToString(value);

        uint256 scale = 10 ** uint256(decimals);
        uint256 whole = value / scale;
        uint256 fraction = value % scale;

        if (fraction == 0) return _uintToString(whole);

        bytes memory fractionDigits = new bytes(uint256(decimals));
        for (uint256 i = uint256(decimals); i > 0; i--) {
            fractionDigits[i - 1] = bytes1(uint8(48 + (fraction % 10)));
            fraction /= 10;
        }

        uint256 end = fractionDigits.length;
        while (end > 0 && fractionDigits[end - 1] == bytes1(uint8(48))) {
            end--;
        }

        bytes memory trimmedFraction = new bytes(end);
        for (uint256 i = 0; i < end; i++) {
            trimmedFraction[i] = fractionDigits[i];
        }

        return string.concat(_uintToString(whole), ".", string(trimmedFraction));
    }

    function _handleTrustlessResponse(
        uint256 taskId,
        uint256 requestId,
        ResponseWire[] memory responses,
        uint8 status
    ) internal {
        delete trustlessReqIndex[requestId];

        Task storage t = tasks[taskId];
        if (t.state != TaskState.Running) return;

        TrustlessCtx storage ctx = trustlessCtx[taskId];
        if (ctx.awaiting != TrustlessAwaiting.Janice) return;

        if (status != RESPONSE_STATUS_SUCCESS || responses.length == 0) {
            _abortTask(taskId, "janice failed");
            return;
        }

        (
            string memory finishReason,
            string memory assistantMessage,
            ,
            ,
            ,
            bytes[] memory pendingToolCalls
        ) = abi.decode(
            responses[0].result,
            (string, string, string[], string[], string[], bytes[])
        );

        ctx.iterations++;
        bytes32 transcriptHash = keccak256(responses[0].result);
        emit JaniceIteration(taskId, ctx.iterations, requestId, finishReason, transcriptHash);

        if (AgentJaniceLib.eq(finishReason, "max_iterations")) {
            _abortTask(taskId, "max iterations");
            return;
        }

        if (AgentJaniceLib.eq(finishReason, "stop")) {
            _completeTrustlessTask(taskId, assistantMessage);
            return;
        }

        if (!AgentJaniceLib.eq(finishReason, "tool_calls")) {
            _abortTask(taskId, "unsupported janice response");
            return;
        }

        bool paused = false;
        for (uint256 i = 0; i < pendingToolCalls.length; i++) {
            bytes memory toolCalldata = pendingToolCalls[i];
            string memory toolName = AgentJaniceLib.toolNameFromCalldata(toolCalldata);
            bytes memory toolArgs = AgentJaniceLib.toolArgsFromCalldata(toolCalldata);
            if (paused) {
                if (
                    AgentJaniceLib.eq(toolName, "rateSubAgent") ||
                    AgentJaniceLib.eq(toolName, "publishOracle")
                ) {
                    bool postOk = _executeTrustlessTool(taskId, toolName, toolArgs, assistantMessage);
                    emit JaniceToolExecuted(
                        taskId,
                        ctx.iterations,
                        toolName,
                        keccak256(toolArgs),
                        postOk
                    );
                    if (!postOk || t.state != TaskState.Running) return;
                    continue;
                }
                _abortTask(taskId, "unsupported post-pause tool");
                return;
            }
            bool ok = _executeTrustlessTool(taskId, toolName, toolArgs, assistantMessage);
            emit JaniceToolExecuted(
                taskId,
                ctx.iterations,
                toolName,
                keccak256(toolArgs),
                ok
            );
            if (!ok || t.state != TaskState.Running) return;
            if (ctx.awaiting == TrustlessAwaiting.Step || ctx.awaiting == TrustlessAwaiting.Resume) {
                paused = true;
            }
        }

        if (paused) return;

        if (t.state == TaskState.Running && ctx.awaiting == TrustlessAwaiting.Janice) {
            if (ctx.iterations >= ctx.maxIterations) {
                _abortTask(taskId, "max iterations");
                return;
            }
            ctx.awaiting = TrustlessAwaiting.Resume;
            emit JaniceResumeQueued(taskId, ctx.iterations + 1, transcriptHash, "tool_batch_complete");
        }
    }

    // ─── External result submission ────────────────────────────────────────────

    // Permissionless relay — ECDSA-verified. Result held pending rating (no payment yet).
    function submitExternalResult(
        uint256 taskId,
        uint8 stepIdx,
        bytes calldata result,
        bytes calldata signature
    ) external nonReentrant {
        if (result.length > MAX_EXTERNAL_RESULT_SIZE) revert ResultTooLarge();
        if (tasks[taskId].state != TaskState.Running) revert TaskNotRunning();
        if (stepIdx >= tasks[taskId].runtime.length) revert StepOutOfRange();
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        if (rt.state != StepState.RunningExternal) revert NotAwaitingExternal();
        if (block.timestamp > rt.deadline) revert StepExpired();
        if (rt.externalRegistrant == address(0)) revert NoRegistrant();

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
        if (recovered == address(0) || recovered != rt.externalRegistrant) revert BadSignature();

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
        if (rt.state != StepState.AwaitingRating) revert NotPendingRating();

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
        if (tasks[taskId].state != TaskState.Running) revert TaskNotRunning();
        if (stepIdx >= tasks[taskId].runtime.length) revert StepOutOfRange();
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        if (!(rt.state == StepState.AwaitingRating && block.timestamp >= rt.deadline)) revert NotTimedOut();
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
        if (tasks[taskId].state != TaskState.Running) revert TaskNotRunning();
        if (stepIdx >= tasks[taskId].runtime.length) revert StepOutOfRange();
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        if (!(rt.state == StepState.RunningExternal && block.timestamp >= rt.deadline)) revert NotTimedOut();
        uint256 configId = rt.externalConfigId;

        rt.state = StepState.TimedOut;                             // CEI
        agentRegistry.decrementActiveStep(configId);
        agentRegistry.recordFailure(configId, true);
        _advance(taskId, stepIdx, false, bytes(""));
    }

    // Native validators never produced a callback.
    function timeoutNativeStep(uint256 taskId, uint8 stepIdx) external nonReentrant {
        if (tasks[taskId].state != TaskState.Running) revert TaskNotRunning();
        if (stepIdx >= tasks[taskId].runtime.length) revert StepOutOfRange();
        StepRuntime storage rt = tasks[taskId].runtime[stepIdx];
        if (!(rt.state == StepState.RunningNative && block.timestamp >= rt.deadline)) revert NotTimedOut();
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
        if (t.state != TaskState.Running) revert NotRunning();
        if (block.timestamp < t.deadline) revert NotTimedOut();
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

    function _completeTrustlessTask(uint256 taskId, string memory result) internal {
        trustlessCtx[taskId].awaiting = TrustlessAwaiting.Done;
        _completeTask(taskId, result);
    }

    // _abortTask: decrement active counters for in-flight external steps, sweep, release lock.
    function _abortTask(uint256 taskId, string memory reason) internal {
        Task storage t = tasks[taskId];
        TrustlessCtx storage ctx = trustlessCtx[taskId];
        if (ctx.janiceRequestId != 0) {
            delete trustlessReqIndex[ctx.janiceRequestId];
        }
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
        if (t.mode == PlanMode.TrustlessJanice) {
            ctx.awaiting = TrustlessAwaiting.Done;
        }
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
                if (t.mode == PlanMode.TrustlessJanice) {
                    TrustlessCtx storage trustless = trustlessCtx[taskId];
                    trustless.awaiting = TrustlessAwaiting.Resume;
                    emit JaniceResumeQueued(
                        taskId,
                        trustless.iterations + 1,
                        keccak256(result),
                        "step_succeeded"
                    );
                } else {
                    _completeTask(taskId, string(result));
                }
            } else {
                _dispatchStep(taskId);
            }
        } else {
            StepRuntime storage rt = t.runtime[stepIdx];
            if (rt.state == StepState.TimedOut) {
                if (t.mode == PlanMode.TrustlessJanice) {
                    TrustlessCtx storage trustlessTimedOut = trustlessCtx[taskId];
                    trustlessTimedOut.awaiting = TrustlessAwaiting.Resume;
                    emit JaniceResumeQueued(
                        taskId,
                        trustlessTimedOut.iterations + 1,
                        keccak256(bytes("step timed out")),
                        "step_failed"
                    );
                } else {
                    _abortTask(taskId, "step timed out");
                }
                return;
            }
            if (rt.retryCount < MAX_RETRIES) {
                rt.retryCount++;
                rt.state = StepState.Retrying;
                // Snapshot byCapability array at retry-start to avoid Elo-write mutations (R2-24).
                uint256[] memory snapshot = _snapshotByCapability(stepIdx, t);
                bool dispatched = _retryWithSnapshot(taskId, stepIdx, snapshot);
                if (!dispatched) {
                    if (t.mode == PlanMode.TrustlessJanice) {
                        TrustlessCtx storage trustlessFailed = trustlessCtx[taskId];
                        trustlessFailed.awaiting = TrustlessAwaiting.Resume;
                        emit JaniceResumeQueued(
                            taskId,
                            trustlessFailed.iterations + 1,
                            keccak256(bytes("step failed")),
                            "step_failed"
                        );
                    } else {
                        _abortTask(taskId, "step failed");
                    }
                }
            } else {
                if (t.mode == PlanMode.TrustlessJanice) {
                    TrustlessCtx storage trustlessExhausted = trustlessCtx[taskId];
                    trustlessExhausted.awaiting = TrustlessAwaiting.Resume;
                    emit JaniceResumeQueued(
                        taskId,
                        trustlessExhausted.iterations + 1,
                        keccak256(bytes("step failed")),
                        "step_failed"
                    );
                } else {
                    _abortTask(taskId, "step failed");
                }
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

    function _stepCostForConfig(uint256 configId) internal view returns (uint256) {
        AgentRegistry.SubAgent memory a = agentRegistry.get(configId);
        if (!(a.isActive && a.lane == AgentLane.SomniaNative)) revert BadNativeConfig();
        return agentsApi.getRequestDeposit() + (a.costWei * SUBCOMMITTEE_SIZE);
    }

    function _externalStepCost(uint256 configId) internal view returns (uint256) {
        AgentRegistry.SubAgent memory a = agentRegistry.get(configId);
        return a.costWei;
    }

    function _affordableStepCost(
        uint256 taskId,
        uint8 stepIdx,
        uint256 configId
    ) internal view returns (uint256) {
        AgentRegistry.SubAgent memory a = agentRegistry.get(configId);
        uint256 stepCost = a.lane == AgentLane.SomniaNative
            ? _stepCostForConfig(configId)
            : _externalStepCost(configId);
        Step memory step = tasks[taskId].steps[stepIdx];
        if (stepCost > step.maxCostWei) return type(uint256).max;
        if (tasks[taskId].spentWei + stepCost > tasks[taskId].budgetWei) return type(uint256).max;
        return stepCost;
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
            if (_affordableStepCost(taskId, stepIdx, snapshot[i]) == type(uint256).max) continue;
            tasks[taskId].steps[stepIdx].subAgentConfigId = snapshot[i];
            _dispatchStep(taskId);
            return true;
        }
        return false;
    }

    // ─── Refresh hook ─────────────────────────────────────────────────────────

    function createRefreshTaskFromPulledFunds(
        uint256 personalAgentId,
        Step[] calldata steps,
        uint256 budget
    ) external payable returns (uint256 taskId) {
        if (msg.sender != refreshManager) revert OnlyRefreshManager();
        return _createTaskInternal(personalAgentId, steps, budget, PlanMode.ClaudePlan);
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

    function _startJaniceRequest(uint256 taskId, bytes memory payload) internal {
        Task storage t = tasks[taskId];
        TrustlessCtx storage ctx = trustlessCtx[taskId];
        policy.requireNotKilled(t.personalAgentId);

        uint256 stepCost = _nativeRequestCost(JANICE_CONFIG_ID);
        if (t.spentWei + stepCost > t.budgetWei) revert BudgetExhausted();

        t.spentWei += stepCost;
        vault.payNative(taskId, stepCost);

        AgentRegistry.SubAgent memory janice = agentRegistry.get(JANICE_CONFIG_ID);
        uint256 reqId = agentsApi.createRequest{value: stepCost}(
            janice.somniaAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        ctx.awaiting = TrustlessAwaiting.Janice;
        ctx.janiceRequestId = reqId;
        trustlessReqIndex[reqId] = taskId;
    }

    function _nativeRequestCost(uint256 configId) internal view returns (uint256) {
        AgentRegistry.SubAgent memory a = agentRegistry.get(configId);
        if (!(a.isActive && a.lane == AgentLane.SomniaNative)) revert BadNativeConfig();
        return agentsApi.getRequestDeposit() + (a.costWei * SUBCOMMITTEE_SIZE);
    }

    function _executeTrustlessTool(
        uint256 taskId,
        string memory toolName,
        bytes memory toolArgs,
        string memory assistantMessage
    ) internal returns (bool) {
        Task storage t = tasks[taskId];
        TrustlessCtx storage ctx = trustlessCtx[taskId];

        if (AgentJaniceLib.eq(toolName, "hireSubAgent")) {
            (
                uint256 configId,
                bytes memory payload,
                uint256 maxCostWei,
                uint32 timeoutSeconds
            ) = abi.decode(toolArgs, (uint256, bytes, uint256, uint32));
            if (t.steps.length >= MAX_STEPS) revert MaxStepsReached();
            t.steps.push(
                Step({
                    subAgentConfigId: configId,
                    payload: payload,
                    maxCostWei: maxCostWei,
                    timeoutSeconds: timeoutSeconds
                })
            );
            t.runtime.push();
            uint8 stepIdx = uint8(t.steps.length - 1);
            emit TrustlessStepAppended(taskId, stepIdx, configId, payload, maxCostWei, timeoutSeconds);
            t.cursor = stepIdx;
            ctx.awaiting = TrustlessAwaiting.Step;
            _dispatchStep(taskId);
            return true;
        }

        if (AgentJaniceLib.eq(toolName, "completeTrustlessTask")) {
            string memory finalResult = abi.decode(toolArgs, (string));
            _completeTrustlessTask(taskId, bytes(finalResult).length == 0 ? assistantMessage : finalResult);
            return true;
        }

        if (AgentJaniceLib.eq(toolName, "publishOracle")) {
            if (refreshManager == address(0)) {
                _abortTask(taskId, "refresh manager unset");
                return false;
            }
            (
                uint256 personalAgentId,
                string memory topic,
                string memory value,
                uint8 confidence,
                uint256 maxAgeSeconds,
                uint256 refreshInterval,
                bytes32 templateHash
            ) = abi.decode(toolArgs, (uint256, string, string, uint8, uint256, uint256, bytes32));
            (bool ok, ) = refreshManager.call(
                abi.encodeWithSignature(
                    "publishFeedAndMaybeSchedule(uint256,string,string,uint8,uint256,uint256,bytes32)",
                    personalAgentId,
                    topic,
                    value,
                    confidence,
                    maxAgeSeconds,
                    refreshInterval,
                    templateHash
                )
            );
            if (!ok) {
                _abortTask(taskId, "publish oracle failed");
                return false;
            }
            return true;
        }

        if (AgentJaniceLib.eq(toolName, "rateSubAgent")) {
            (uint256 configId, uint32 latencyMs, uint8 score) = abi.decode(
                toolArgs,
                (uint256, uint32, uint8)
            );
            agentRegistry.recordSuccess(configId, latencyMs, score);
            return true;
        }

        _abortTask(taskId, "unknown trustless tool");
        return false;
    }

}
