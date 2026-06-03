// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Pure task-time escrow (R4-1).
// Persistent STT lives in the agent's ERC-6551 account.
// Vault only holds STT while a task is running — funded once at createTask,
// swept back to the 6551 account on completion/abort.
//
// REMOVED: owners, balances, setOwner, deposit, withdraw, refundStep.
contract AgentVault is ReentrancyGuard {
    address public immutable deployer;
    address public           orchestrator;   // one-shot setter

    mapping(uint256 => uint256) public taskLockedAmount;  // taskId → locked wei

    event TaskLocked(uint256 indexed taskId, uint256 indexed personalAgentId, uint256 amount);
    event NativePaid(uint256 indexed taskId, uint256 amount);
    event ExternalPaymentReleased(uint256 indexed taskId, uint8 stepIdx, address to, uint256 amount);
    event TaskRefunded(uint256 indexed taskId, address twiinAccountAddr, uint256 amount);
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

    // Called once at createTask. Full task budget locked here.
    // Orchestrator forwards msg.value from the 6551 account's execute() call.
    function lockStep(
        uint256 personalAgentId,
        uint256 taskId,
        uint256 amt
    ) external payable onlyOrchestrator {
        require(msg.value == amt, "value mismatch");
        taskLockedAmount[taskId] += amt;
        emit TaskLocked(taskId, personalAgentId, amt);
    }

    // Native-lane funding: pull cost from task pool into Orchestrator,
    // which then forwards into agentsApi.createRequest{value: amt}.
    function payNative(uint256 taskId, uint256 amt) external onlyOrchestrator nonReentrant {
        require(taskLockedAmount[taskId] >= amt, "insufficient lock");
        taskLockedAmount[taskId] -= amt;   // CEI: state before call
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");
        emit NativePaid(taskId, amt);
    }

    // External-lane payment: release escrow to the external agent's registrant.
    function releaseExternal(
        uint256 taskId,
        uint8 stepIdx,
        address payable to,
        uint256 amt
    ) external onlyOrchestrator nonReentrant {
        require(taskLockedAmount[taskId] >= amt, "insufficient lock");
        taskLockedAmount[taskId] -= amt;   // CEI
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "transfer failed");
        emit ExternalPaymentReleased(taskId, stepIdx, to, amt);
    }

    // End-of-task: return unused STT to the agent's 6551 account.
    function sweepTaskRemainder(
        uint256 taskId,
        address payable twiinAccountAddr,
        uint256 amt
    ) external onlyOrchestrator nonReentrant {
        require(taskLockedAmount[taskId] >= amt, "insufficient lock");
        taskLockedAmount[taskId] -= amt;   // CEI
        (bool ok, ) = twiinAccountAddr.call{value: amt}("");
        require(ok, "transfer failed");
        emit TaskRefunded(taskId, twiinAccountAddr, amt);
    }
}
