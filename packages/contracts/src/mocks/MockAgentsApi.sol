// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    IAgentRequester,
    ResponseWire,
    ResponseStatus,
    RequestWire,
    ConsensusType
} from "../interfaces/IAgentRequesterHandler.sol";

// Mock IAgentRequester for unit tests.
// Stores pending requests; test drives resolution via fulfill / failRequest.
contract MockAgentsApi is IAgentRequester {
    uint256 public constant MOCK_DEPOSIT = 0.03e18;

    struct Pending {
        address callback;
        bytes4  selector;
        bool    exists;
    }

    uint256 public nextReqId;
    mapping(uint256 => Pending) public pending;
    mapping(uint256 => bytes) public requestPayloads;

    event RequestCreated(uint256 indexed reqId, uint256 agentId, bytes payload);

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4  callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        requestId = ++nextReqId;
        pending[requestId] = Pending({
            callback: callbackAddress,
            selector: callbackSelector,
            exists: true
        });
        requestPayloads[requestId] = payload;
        emit RequestCreated(requestId, agentId, payload);
    }

    function getRequestDeposit() external pure returns (uint256) {
        return MOCK_DEPOSIT;
    }

    // Test helper: fulfill a pending request with a single-validator result.
    function fulfill(uint256 reqId, bytes calldata result) external {
        uint256[] memory costs = new uint256[](1);
        costs[0] = 0;
        fulfillConsensus(reqId, result, costs, 1);
    }

    // Test helper: fulfill with N validator responses (consensus receipt tests).
    function fulfillConsensus(
        uint256 reqId,
        bytes calldata result,
        uint256[] memory executionCosts,
        uint256 firstReceiptId
    ) public {
        Pending memory p = pending[reqId];
        require(p.exists, "no request");
        require(executionCosts.length > 0, "no validators");
        delete pending[reqId];

        ResponseWire[] memory responses = new ResponseWire[](executionCosts.length);
        for (uint256 i = 0; i < executionCosts.length; i++) {
            responses[i] = ResponseWire({
                validator: address(uint160(uint256(keccak256(abi.encode(msg.sender, i))) % type(uint160).max)),
                result: result,
                status: uint8(ResponseStatus.Success),
                receipt: firstReceiptId + i,
                timestamp: block.timestamp,
                executionCost: executionCosts[i]
            });
        }

        RequestWire memory req = RequestWire({
            id: reqId,
            requester: msg.sender,
            callbackAddress: p.callback,
            callbackSelector: p.selector,
            subcommittee: new address[](0),
            responses: new ResponseWire[](0),
            responseCount: uint256(responses.length),
            failureCount: 0,
            threshold: uint256(responses.length),
            createdAt: block.timestamp,
            deadline: block.timestamp + 600,
            status: uint8(ResponseStatus.Success),
            consensusType: uint8(ConsensusType.Majority),
            remainingBudget: 0,
            perAgentBudget: 0
        });

        (bool ok, ) = p.callback.call(
            abi.encodeWithSelector(p.selector, reqId, responses, uint8(ResponseStatus.Success), req)
        );
        require(ok, "callback failed");
    }

    // Test helper: fulfill with under-participation (threshold > validators).
    function fulfillUnderParticipation(uint256 reqId, bytes calldata result) external {
        Pending memory p = pending[reqId];
        require(p.exists, "no request");
        delete pending[reqId];

        ResponseWire[] memory responses = new ResponseWire[](1);
        responses[0] = ResponseWire({
            validator: msg.sender,
            result: result,
            status: uint8(ResponseStatus.Success),
            receipt: 42,
            timestamp: block.timestamp,
            executionCost: 1e16
        });

        RequestWire memory req = RequestWire({
            id: reqId,
            requester: msg.sender,
            callbackAddress: p.callback,
            callbackSelector: p.selector,
            subcommittee: new address[](0),
            responses: new ResponseWire[](0),
            responseCount: 1,
            failureCount: 0,
            threshold: 3,
            createdAt: block.timestamp,
            deadline: block.timestamp + 600,
            status: uint8(ResponseStatus.Success),
            consensusType: uint8(ConsensusType.Majority),
            remainingBudget: 0,
            perAgentBudget: 0
        });

        (bool ok, ) = p.callback.call(
            abi.encodeWithSelector(p.selector, reqId, responses, uint8(ResponseStatus.Success), req)
        );
        require(ok, "callback failed");
    }

    // Test helper: fail a pending request.
    function failRequest(uint256 reqId) external {
        Pending memory p = pending[reqId];
        require(p.exists, "no request");
        delete pending[reqId];

        ResponseWire[] memory responses = new ResponseWire[](0);
        RequestWire memory req;

        (bool ok, ) = p.callback.call(
            abi.encodeWithSelector(p.selector, reqId, responses, uint8(ResponseStatus.Failed), req)
        );
        require(ok, "callback failed");
    }
}
