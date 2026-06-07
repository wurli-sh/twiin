// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title AgentJaniceLib — pure Janice encoding/parsing (linked library to shrink orchestrator)
library AgentJaniceLib {
    struct OnchainTool {
        string signature;
        string description;
    }

    bytes4 internal constant SEL_HIRE_SUB_AGENT =
        bytes4(keccak256("hireSubAgent(uint256,bytes,uint256,uint32)"));
    bytes4 internal constant SEL_COMPLETE_TRUSTLESS =
        bytes4(keccak256("completeTrustlessTask(string)"));
    bytes4 internal constant SEL_PUBLISH_ORACLE =
        bytes4(keccak256("publishOracle(uint256,string,string,uint8,uint256,uint256,bytes32)"));
    bytes4 internal constant SEL_RATE_SUB_AGENT =
        bytes4(keccak256("rateSubAgent(uint256,uint32,uint8)"));

    function eq(string memory a, string memory b) external pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function toolArgsFromCalldata(bytes memory toolCalldata) external pure returns (bytes memory args) {
        if (toolCalldata.length <= 4) return "";
        args = new bytes(toolCalldata.length - 4);
        for (uint256 i = 0; i < args.length; i++) {
            args[i] = toolCalldata[i + 4];
        }
    }

    function toolNameFromCalldata(bytes memory toolCalldata) external pure returns (string memory) {
        if (toolCalldata.length < 4) return "unknown";
        bytes4 sel;
        assembly {
            sel := mload(add(toolCalldata, 32))
        }
        if (sel == SEL_HIRE_SUB_AGENT) return "hireSubAgent";
        if (sel == SEL_COMPLETE_TRUSTLESS) return "completeTrustlessTask";
        if (sel == SEL_PUBLISH_ORACLE) return "publishOracle";
        if (sel == SEL_RATE_SUB_AGENT) return "rateSubAgent";
        return "unknown";
    }

    function buildInitialJanicePayload(
        string memory goal,
        uint8 inferToolsChatMaxIterations
    ) external pure returns (bytes memory) {
        string[] memory roles = new string[](2);
        roles[0] = "system";
        roles[1] = "user";
        string[] memory messages = new string[](2);
        messages[0] = trustlessSystemPrompt();
        messages[1] = goal;
        return _encodeJanicePayload(roles, messages, inferToolsChatMaxIterations);
    }

    function encodeJanicePayload(
        string[] memory roles,
        string[] memory messages,
        uint8 inferToolsChatMaxIterations
    ) external pure returns (bytes memory) {
        return _encodeJanicePayload(roles, messages, inferToolsChatMaxIterations);
    }

    function _encodeJanicePayload(
        string[] memory roles,
        string[] memory messages,
        uint8 inferToolsChatMaxIterations
    ) private pure returns (bytes memory) {
        string[] memory mcpUrls = new string[](0);
        return abi.encodeWithSignature(
            "inferToolsChat(string[],string[],string[],(string,string)[],uint256,bool)",
            roles,
            messages,
            mcpUrls,
            trustlessOnchainTools(),
            uint256(inferToolsChatMaxIterations),
            false
        );
    }

    function trustlessSystemPrompt() public pure returns (string memory) {
        return "You are Janice, a trustless planner on Twiin. Use the provided on-chain tools to hire sub-agents, publish oracle data, rate agents, or complete the task with a final result.";
    }

    function trustlessOnchainTools() public pure returns (OnchainTool[] memory tools) {
        tools = new OnchainTool[](4);
        tools[0].signature = "hireSubAgent(uint256,bytes,uint256,uint32)";
        tools[1].signature = "completeTrustlessTask(string)";
        tools[2].signature = "publishOracle(uint256,string,string,uint8,uint256,uint256,bytes32)";
        tools[3].signature = "rateSubAgent(uint256,uint32,uint8)";
        tools[0].description = "Hire a registered sub-agent. Args: configId, ABI-encoded step payload, maxCostWei, timeoutSeconds.";
        tools[1].description = "Finish the trustless task with a concise final user-facing result.";
        tools[2].description = "Publish oracle feed data. Args: personalAgentId, topic, value, confidence, maxAgeSeconds, refreshInterval, templateHash.";
        tools[3].description = "Rate a sub-agent. Args: configId, latencyMs, score (0-100).";
    }
}
