import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AgentRegistryAbi,
  CHAIN_ID,
  CapabilityId,
  loadDeploymentManifest,
} from "@twiin/shared";
import { loadEnv } from "../src/env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");

async function main() {
  const env = loadEnv();
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
  const endpointUrl = env.EXTERNAL_PUBLIC_URL ?? `http://127.0.0.1:${env.PORT}`;
  const caps = [CapabilityId.WEB_SCRAPE_DISCORD];

  console.log(`[discord-bot] registrant=${account.address}`);
  console.log(`[discord-bot] endpoint=${endpointUrl}`);
  console.log(`[discord-bot] costWei=${env.AGENT_COST_WEI.toString()}`);

  const alreadyRegistered = await registry.read.isRegisteredExternal([account.address]);
  if (!alreadyRegistered) {
    const txHash = await registry.write.registerExternalAgent(
      [env.AGENT_NAME, endpointUrl, env.AGENT_COST_WEI, caps],
      { value: env.REGISTRATION_DEPOSIT_WEI, account },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const configId = await findLatestConfigId(publicClient, registry.address, account.address);
    console.log(`[discord-bot] registered tx=${txHash} configId=${configId?.toString() ?? "unknown"}`);
    console.log(`[discord-bot] receipt status=${receipt.status}`);
    return;
  }

  const configId = await findLatestConfigId(publicClient, registry.address, account.address);
  if (configId == null) {
    throw new Error("existing registration found, but configId lookup failed");
  }

  const endpointTx = await registry.write.updateEndpoint([configId, endpointUrl], { account });
  await publicClient.waitForTransactionReceipt({ hash: endpointTx });
  const costTx = await registry.write.updateCost([configId, env.AGENT_COST_WEI], { account });
  await publicClient.waitForTransactionReceipt({ hash: costTx });
  console.log(`[discord-bot] updated configId=${configId.toString()} endpoint tx=${endpointTx} cost tx=${costTx}`);
}

async function findLatestConfigId(
  publicClient: ReturnType<typeof createPublicClient>,
  registryAddress: `0x${string}`,
  registrant: `0x${string}`,
): Promise<bigint | null> {
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = BigInt(deploymentRaw.startBlock);
  const event = parseAbiItem(
    "event ExternalAgentRegistered(uint256 indexed configId, address indexed registrant, string endpointUrl, bytes32 endpointHash, bytes32[] caps, uint256 costWei)",
  );
  let latestConfigId: bigint | null = null;

  for (let start = fromBlock; start <= latestBlock; start += 1000n) {
    const end = start + 999n > latestBlock ? latestBlock : start + 999n;
    const logs = await publicClient.getLogs({
      address: registryAddress,
      event,
      args: { registrant },
      fromBlock: start,
      toBlock: end,
    });
    const candidate = logs.at(-1)?.args.configId ?? null;
    if (candidate != null) latestConfigId = candidate;
  }

  return latestConfigId;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
