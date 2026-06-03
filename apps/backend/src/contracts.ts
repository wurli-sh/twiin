import { getContract } from "viem";
import {
  AgentOrchestratorAbi,
  AgentRegistryAbi,
  OracleFeedAbi,
  TwiinAgentAbi,
  loadAddresses,
} from "@twiin/shared";
import { publicClient, walletClient } from "./clients";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addressesRaw = require("../../../packages/shared/addresses.json");
export const addresses = loadAddresses(addressesRaw);

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
