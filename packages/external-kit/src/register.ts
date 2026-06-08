import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AgentRegistryAbi,
  CHAIN_ID,
  loadDeploymentManifest,
  type CapabilityId,
} from "@twiin/shared";
import type { ExternalBaseEnv } from "./env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");

export async function registerExternalAgent(
  env: ExternalBaseEnv,
  caps: readonly Hex[],
): Promise<void> {
  const deployment = loadDeploymentManifest(deploymentRaw);
  const chain = defineChain({
    id: CHAIN_ID,
    name: "Somnia Testnet",
    nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [env.SOMNIA_RPC_URL] } },
  });
  const account = privateKeyToAccount(env.EXTERNAL_PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({
    chain,
    transport: http(env.SOMNIA_RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(env.SOMNIA_RPC_URL),
  });
  const registry = getContract({
    address: deployment.addresses.agentRegistry as `0x${string}`,
    abi: AgentRegistryAbi,
    client: { public: publicClient, wallet: walletClient },
  });
  const endpointUrl = env.EXTERNAL_PUBLIC_URL ?? `http://${env.HOST}:${env.PORT}`;

  console.log(`[${env.AGENT_NAME}] registrant=${account.address}`);
  console.log(`[${env.AGENT_NAME}] endpoint=${endpointUrl}`);
  console.log(`[${env.AGENT_NAME}] costWei=${env.AGENT_COST_WEI.toString()}`);

  const nameHash = keccak256(toBytes(env.AGENT_NAME));
  const configId = await registry.read.configIdByName([nameHash]);
  const alreadyRegistered = configId > 0n;

  if (!alreadyRegistered) {
    const txHash = await registry.write.registerExternalAgent(
      [env.AGENT_NAME, endpointUrl, env.AGENT_COST_WEI, caps as `0x${string}`[]],
      { value: env.REGISTRATION_DEPOSIT_WEI, account },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const newConfigId = await registry.read.configIdByName([nameHash]);
    console.log(
      `[${env.AGENT_NAME}] registered tx=${txHash} configId=${newConfigId?.toString() ?? "unknown"}`,
    );
    console.log(`[${env.AGENT_NAME}] receipt status=${receipt.status}`);
    return;
  }

  const existing = await registry.read.agents([configId]);
  const existingName = existing[0];
  if (existingName !== env.AGENT_NAME) {
    throw new Error(
      [
        `name hash collision for "${env.AGENT_NAME}" → existing agent "${existingName}"`,
        "this should not happen with unique agent names",
      ].join("; "),
    );
  }

  const endpointTx = await registry.write.updateEndpoint([configId, endpointUrl], { account });
  await publicClient.waitForTransactionReceipt({ hash: endpointTx });
  const costTx = await registry.write.updateCost([configId, env.AGENT_COST_WEI], { account });
  await publicClient.waitForTransactionReceipt({ hash: costTx });
  console.log(
    `[${env.AGENT_NAME}] updated configId=${configId.toString()} endpoint tx=${endpointTx} cost tx=${costTx}`,
  );
}

export type { CapabilityId };
