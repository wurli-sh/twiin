import {
  createPublicClient,
  defineChain,
  getContract,
  http,
  keccak256,
  toBytes,
} from "viem";
import { loadBaseEnv, registerExternalAgent } from "../src";
import {
  AgentRegistryAbi,
  CHAIN_ID,
  loadDeploymentManifest,
} from "@twiin/shared";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deploymentRaw = require("@twiin/shared/deployments/somniaTestnet.json");

const AGENTS = [
  { name: "briefsmith",        port: 3015, costStt: "0.22" },
  { name: "dreamdex-mcp",      port: 3012, costStt: "0.20" },
  { name: "docs-lens",         port: 3011, costStt: "0.15" },
  { name: "onchain-lens",      port: 3013, costStt: "0.16" },
  { name: "reactivity-lens",   port: 3016, costStt: "0.17" },
  { name: "receipt-auditor",   port: 3014, costStt: "0.14" },
  { name: "agent-adapter",     port: 8790, costStt: "0.20" },
] as const;

const isAudit = process.argv.includes("--audit") || process.argv.includes("--dry-run");

function fingerprint(pk: string): string {
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(pk).digest("hex").slice(0, 10);
}

async function audit() {
  const deployment = loadDeploymentManifest(deploymentRaw);
  const chain = defineChain({ id: CHAIN_ID, name: "Somnia Testnet", nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 }, rpcUrls: { default: { http: ["https://dream-rpc.somnia.network/"] } } });
  const client = createPublicClient({ chain, transport: http("https://dream-rpc.somnia.network/") });
  const registry = getContract({ address: deployment.addresses.agentRegistry, abi: AgentRegistryAbi, client: { public: client } });
  const nextConfigId = await registry.read.nextConfigId();

  console.log(`nextConfigId=${nextConfigId.toString()}`);
  console.log("");

  for (const agent of AGENTS) {
    const nameHash = keccak256(toBytes(agent.name));
    const configId = await registry.read.configIdByName([nameHash]).catch(() => 0n);
    const status = configId > 0n ? `registered (configId=${configId.toString()})` : "unregistered";
    console.log(`  ${agent.name.padEnd(20)} ${status}`);
  }

  const pk = process.env.EXTERNAL_PRIVATE_KEY;
  if (pk) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(`0x${pk.replace(/^0x/, "")}` as `0x${string}`);
    console.log(`\nregistrant=${account.address} key=${fingerprint(pk)}`);
  }
}

async function main() {
  if (isAudit) {
    await audit();
    return;
  }

  if (!process.env.EXTERNAL_PRIVATE_KEY) {
    console.error("Set EXTERNAL_PRIVATE_KEY env var");
    process.exit(1);
  }

  const somniaRpcUrl = process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network/";
  const host = process.env.HOST ?? "127.0.0.1";
  const depositStt = process.env.REGISTRATION_DEPOSIT_STT ?? "5";

  let registered = 0;

  for (const agent of AGENTS) {
    const env = loadBaseEnv(process.env, {
      AGENT_NAME: agent.name,
      PORT: agent.port,
      AGENT_COST_STT: agent.costStt,
      REGISTRATION_DEPOSIT_STT: depositStt,
    });
    env.HOST = host;
    env.SOMNIA_RPC_URL = somniaRpcUrl;

    await registerExternalAgent(env, []);
    registered++;
  }

  console.log(`\nDone. ${registered} agents registered.`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
