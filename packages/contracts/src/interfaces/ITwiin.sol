// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Minimal cross-contract interfaces that break the TwiinAgent <-> Orchestrator
// circular dependency and allow TwiinAccount to read the canonical orchestrator.

interface ITwiinAgent {
    function orchestrator() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function factory() external view returns (address);
}

interface IOrchestrator {
    function taskLock(uint256 personalAgentId) external view returns (uint256);
}
