import { getContract } from "viem";
import {
  AgentOrchestratorAbi,
  AgentRegistryAbi,
  OracleFeedAbi,
  TwiinAgentAbi,
  loadAddresses,
  loadDeploymentManifest,
} from "@twiin/shared";
import { publicClient, walletClient } from "./clients";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addressesRaw = require("@twiin/shared/addresses.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");
export const addresses = loadAddresses(addressesRaw);
export const deployment = loadDeploymentManifest(deploymentRaw);
const deploymentStartBlock =
  (deploymentRaw as { startBlock?: string }).startBlock ??
  (deployment as { startBlock?: string }).startBlock ??
  "0";
export const defaultStartBlock = BigInt(deploymentStartBlock);
export const capabilityNameById = new Map(
  deployment.capabilities.map((cap) => [cap.id.toLowerCase(), cap.name]),
);

export const orchestratorContract = getContract({
  address: addresses.orchestrator,
  abi: AgentOrchestratorAbi,
  client: { public: publicClient, wallet: walletClient },
});

export const agentRegistryContract = getContract({
  address: addresses.agentRegistry,
  abi: AgentRegistryAbi,
  client: { public: publicClient, wallet: walletClient },
});

export const twiinAgentContract = getContract({
  address: addresses.twiinAgent,
  abi: TwiinAgentAbi,
  client: publicClient,
});

export const oracleFeedContract = getContract({
  address: addresses.oracleFeed,
  abi: OracleFeedAbi,
  client: { public: publicClient, wallet: walletClient },
});
