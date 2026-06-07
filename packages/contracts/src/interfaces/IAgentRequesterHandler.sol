// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Struct/enum layout must match the Somnia platform exactly — ABI decoded from callbacks.
enum ConsensusType { Majority, Threshold }
enum ResponseStatus { None, Pending, Success, Failed, TimedOut }

struct Response {
    address validator;
    bytes   result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct ResponseWire {
    address validator;
    bytes   result;
    uint8   status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4  callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType  consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

struct RequestWire {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4  callbackSelector;
    address[] subcommittee;
    ResponseWire[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    uint8   status;
    uint8   consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        ResponseWire[] memory responses,
        uint8 status,
        RequestWire memory details
    ) external;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4  callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}
