// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { SomniaEventHandler } from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {AgentPolicy} from "./AgentPolicy.sol";
import {OracleFeed} from "./OracleFeed.sol";
import {TwiinAccount} from "./TwiinAccount.sol";
import {Step} from "./TwiinTypes.sol";

interface IRefreshTaskOrchestrator {
    function createRefreshTaskFromPulledFunds(
        uint256 personalAgentId,
        Step[] calldata steps,
        uint256 budget
    ) external payable returns (uint256 taskId);

    function taskLock(uint256 personalAgentId) external view returns (uint256);
}

contract AgentRefreshCoordinator is SomniaEventHandler {
    error NotAllowed();
    error OnlySelf();
    error OnlyKeeper();

    uint256 public constant MAX_STEPS = 8;
    bytes32 public constant TWIIN_6551_SALT = bytes32(0);
    uint64 private constant REFRESH_GAS_LIMIT = 2_000_000;

    IERC6551Registry public immutable registry6551;
    address public immutable twiinAccountImpl;
    address public immutable twiinAgent;
    AgentPolicy public immutable policy;
    OracleFeed public immutable oracleFeed;
    IRefreshTaskOrchestrator public immutable orchestrator;
    address public immutable keeper;
    address public immutable admin;

    struct RefreshEntry {
        uint256 personalAgentId;
        string topic;
        bytes32 templateHash;
        uint256 nonce;
    }

    mapping(uint256 => RefreshEntry[]) internal _scheduledRefreshes;
    mapping(bytes32 => uint256) internal _refreshNonceByTopic;

    event RefreshSkipped(uint256 indexed personalAgentId, string topic, string reason);
    event RefreshScheduled(uint256 indexed personalAgentId, string topic, uint256 timestampMillis, uint256 subscriptionId);

    constructor(
        address _registry6551,
        address _twiinAccountImpl,
        address _twiinAgent,
        address _policy,
        address _oracleFeed,
        address _orchestrator,
        address _keeper,
        address _admin
    ) {
        registry6551 = IERC6551Registry(_registry6551);
        twiinAccountImpl = _twiinAccountImpl;
        twiinAgent = _twiinAgent;
        policy = AgentPolicy(_policy);
        oracleFeed = OracleFeed(_oracleFeed);
        orchestrator = IRefreshTaskOrchestrator(_orchestrator);
        keeper = _keeper;
        admin = _admin;
    }

    receive() external payable {}

    function publishFeedAndMaybeSchedule(
        uint256 personalAgentId,
        string calldata topic,
        string calldata value,
        uint8 confidence,
        uint256 maxAgeSeconds,
        uint256 refreshInterval,
        bytes32 templateHash
    ) external {
        if (msg.sender != admin && msg.sender != address(orchestrator)) revert NotAllowed();
        _publishFeedAndMaybeSchedule(
            personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash
        );
    }

    function publishFeedForOwner(
        uint256 personalAgentId,
        string calldata topic,
        string calldata value,
        uint8 confidence,
        uint256 maxAgeSeconds,
        uint256 refreshInterval,
        bytes32 templateHash
    ) external {
        if (IERC721(twiinAgent).ownerOf(personalAgentId) != msg.sender) revert NotAllowed();
        _publishFeedAndMaybeSchedule(
            personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash
        );
    }

    function registerTaskTemplate(
        Step[] calldata steps,
        uint256 budgetWei
    ) external returns (bytes32 hash) {
        if (msg.sender != admin) revert NotAllowed();
        return oracleFeed.registerTemplate(steps, budgetWei);
    }

    function refreshFromTemplateByKeeper(
        uint256 personalAgentId,
        string calldata topic,
        bytes32 templateHash
    ) external {
        if (msg.sender != keeper) revert OnlyKeeper();
        _refreshFromTemplate(personalAgentId, topic, templateHash);
    }

    function scheduleSubscriptionSelfCall(
        uint256 /*personalAgentId*/,
        string calldata /*topic*/,
        uint256 timestampMillis
    ) external returns (uint256 subscriptionId) {
        if (msg.sender != address(this)) revert OnlySelf();
        SomniaExtensions.SubscriptionOptions memory opts = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: 0,
            maxFeePerGas: 0,
            gasLimit: REFRESH_GAS_LIMIT
        });
        return SomniaExtensions.scheduleSubscriptionAtTimestamp(address(this), timestampMillis, opts);
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

        _scheduledRefreshes[timestampMillis].push(RefreshEntry({
            personalAgentId: personalAgentId,
            topic: topic,
            templateHash: templateHash,
            nonce: nonce
        }));

        try this.scheduleSubscriptionSelfCall(personalAgentId, topic, timestampMillis)
            returns (uint256 subscriptionId)
        {
            emit RefreshScheduled(personalAgentId, topic, timestampMillis, subscriptionId);
        } catch {
            // Fallback keeper refresh remains available when the precompile is absent.
        }
    }

    function _onEvent(
        address /* emitter */,
        bytes32[] calldata eventTopics,
        bytes calldata /* data */
    ) internal override {
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
        delete _scheduledRefreshes[timestampMillis];
    }

    function _refreshFromTemplate(
        uint256 personalAgentId,
        string memory topic,
        bytes32 templateHash
    ) internal {
        if (policy.isKilled(personalAgentId)) {
            emit RefreshSkipped(personalAgentId, topic, "kill switch");
            return;
        }
        if (orchestrator.taskLock(personalAgentId) != 0) {
            emit RefreshSkipped(personalAgentId, topic, "task in flight");
            return;
        }
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
            try orchestrator.createRefreshTaskFromPulledFunds{value: budget}(personalAgentId, steps, budget) {
                // ok
            } catch {
                (bool ok, ) = acct.call{value: budget}("");
                if (!ok) revert NotAllowed();
                emit RefreshSkipped(personalAgentId, topic, "task create");
            }
        } catch {
            emit RefreshSkipped(personalAgentId, topic, "refresh allowance");
        }
    }

    function _preflightRefreshTask(
        uint256 personalAgentId,
        Step[] memory steps,
        uint256 budget
    ) internal view returns (bool) {
        if (orchestrator.taskLock(personalAgentId) != 0) return false;
        if (steps.length == 0 || steps.length > MAX_STEPS) return false;
        if (budget == 0) return false;
        if (!policy.canReserveTaskBudget(personalAgentId, budget)) return false;
        return true;
    }

    function _isRefreshEntryCurrent(RefreshEntry storage entry) internal view returns (bool) {
        bytes32 topicKey = keccak256(abi.encode(entry.personalAgentId, entry.topic));
        return _refreshNonceByTopic[topicKey] == entry.nonce;
    }

    function _twiinAccount(uint256 personalAgentId) internal view returns (address) {
        return registry6551.account(
            twiinAccountImpl,
            TWIIN_6551_SALT,
            block.chainid,
            twiinAgent,
            personalAgentId
        );
    }
}
