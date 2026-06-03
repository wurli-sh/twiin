// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAgentRequester, IAgentRequesterHandler, Response, ResponseStatus, Request} from "../interfaces/IAgentRequesterHandler.sol";

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
        emit RequestCreated(requestId, agentId, payload);
    }

    function getRequestDeposit() external pure returns (uint256) {
        return MOCK_DEPOSIT;
    }

    // Test helper: fulfill a pending request with a result.
    function fulfill(uint256 reqId, bytes calldata result) external {
        Pending memory p = pending[reqId];
        require(p.exists, "no request");
        delete pending[reqId];

        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: msg.sender,
            result: result,
            status: ResponseStatus.Success,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });

        Request memory req;  // empty struct, only used for logging

        (bool ok, ) = p.callback.call(
            abi.encodeWithSelector(p.selector, reqId, responses, ResponseStatus.Success, req)
        );
        require(ok, "callback failed");
    }

    // Test helper: fail a pending request.
    function failRequest(uint256 reqId) external {
        Pending memory p = pending[reqId];
        require(p.exists, "no request");
        delete pending[reqId];

        Response[] memory responses = new Response[](0);
        Request memory req;

        (bool ok, ) = p.callback.call(
            abi.encodeWithSelector(p.selector, reqId, responses, ResponseStatus.Failed, req)
        );
        require(ok, "callback failed");
    }
}
