// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResponseWire, RequestWire} from "../interfaces/IAgentRequesterHandler.sol";

/// @title AgentConsensusLib — Somnia consensus receipt helpers (linked library)
library AgentConsensusLib {
    struct Receipt {
        uint64 validators;
        uint64 finalizedAt;
        uint256 receiptId;
        uint256 executionCost;
    }

    function satisfiesParticipation(
        ResponseWire[] memory responses,
        RequestWire memory details
    ) external pure returns (bool) {
        if (responses.length == 0) return false;
        return responses.length >= _participationNeed(details);
    }

    function buildReceipt(ResponseWire[] memory responses) external view returns (Receipt memory) {
        return Receipt({
            validators: uint64(responses.length),
            finalizedAt: uint64(block.timestamp),
            receiptId: responses[0].receipt,
            executionCost: medianExecutionCost(responses)
        });
    }

    function medianExecutionCost(ResponseWire[] memory responses) public pure returns (uint256) {
        uint256 n = responses.length;
        if (n == 0) return 0;

        uint256[] memory costs = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            costs[i] = responses[i].executionCost;
        }
        for (uint256 i = 1; i < n; i++) {
            uint256 key = costs[i];
            uint256 j = i;
            while (j > 0 && costs[j - 1] > key) {
                costs[j] = costs[j - 1];
                j--;
            }
            costs[j] = key;
        }
        if (n % 2 == 1) return costs[n / 2];
        return costs[n / 2 - 1] / 2 + costs[n / 2] / 2;
    }

    function _participationNeed(RequestWire memory details) private pure returns (uint256) {
        return details.threshold > 0 ? details.threshold : 1;
    }
}
