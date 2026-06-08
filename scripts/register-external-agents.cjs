const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const repoRoot = path.resolve(__dirname, "..");
const workspaceResolvePaths = [
  path.join(repoRoot, "packages/external-kit"),
  path.join(repoRoot, "packages/shared"),
];
function requireWorkspace(specifier) {
  return require(require.resolve(specifier, { paths: workspaceResolvePaths }));
}
const { createPublicClient, defineChain, getContract, http } = requireWorkspace("viem");
const { privateKeyToAccount } = requireWorkspace("viem/accounts");
const {
  AgentRegistryAbi,
  CHAIN_ID,
  TwiinNamesAbi,
  loadDeploymentManifest,
} = requireWorkspace("@twiin/shared");
const deploymentRaw = requireWorkspace("@twiin/shared/deployments/somniaTestnet.json");

const AGENTS = [
  { name: "docs-lens", packageName: "@twiin/docs-lens", dir: "apps/docs-lens" },
  { name: "reactivity-lens", packageName: "@twiin/reactivity-lens", dir: "apps/reactivity-lens" },
  { name: "dreamdex-mcp", packageName: "@twiin/dreamdex-mcp", dir: "apps/dreamdex-mcp" },
  { name: "onchain-lens", packageName: "@twiin/onchain-lens", dir: "apps/onchain-lens" },
  { name: "receipt-auditor", packageName: "@twiin/receipt-auditor", dir: "apps/receipt-auditor" },
  { name: "briefsmith", packageName: "@twiin/briefsmith", dir: "apps/briefsmith" },
  { name: "agent-adapter", packageName: "@twiin/agent-adapter", dir: "apps/agent-adapter" },
];

function parseArgs(argv) {
  const args = { register: false, selected: new Set() };
  for (const token of argv) {
    if (token === "--register") {
      args.register = true;
      continue;
    }
    if (token === "--audit") continue;
    args.selected.add(token);
  }
  return args;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const entries = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function loadAgentEnv(agent) {
  const appDir = path.join(repoRoot, agent.dir);
  return {
    ...readEnvFile(path.join(repoRoot, ".env.external-agents.local")),
    ...readEnvFile(path.join(repoRoot, ".env.external-agents")),
    ...readEnvFile(path.join(appDir, ".env.local")),
    ...readEnvFile(path.join(appDir, ".env")),
  };
}

function normalizePrivateKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed;
  return null;
}

function isValidAgentName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 32 && /^[a-z0-9-]+$/.test(name);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

async function buildAuditRows(selectedNames) {
  const deployment = loadDeploymentManifest(deploymentRaw);
  const chain = defineChain({
    id: CHAIN_ID,
    name: "Somnia Testnet",
    nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: ["https://dream-rpc.somnia.network/"] } },
  });
  const publicClient = createPublicClient({
    chain,
    transport: http("https://dream-rpc.somnia.network/"),
  });
  const registry = getContract({
    address: deployment.addresses.agentRegistry,
    abi: AgentRegistryAbi,
    client: { public: publicClient },
  });
  const twiinNames = getContract({
    address: deployment.addresses.twiinNames,
    abi: TwiinNamesAbi,
    client: { public: publicClient },
  });
  const nextConfigId = await registry.read.nextConfigId();
  const registrationsByRegistrant = new Map();

  for (let configId = 6n; configId < nextConfigId; configId += 1n) {
    const agent = await registry.read.agents([configId]);
    const registrant = agent[11];
    if (registrant === "0x0000000000000000000000000000000000000000") continue;
    registrationsByRegistrant.set(registrant.toLowerCase(), {
      configId,
      name: agent[0],
    });
  }

  const rows = [];
  const byAddress = new Map();

  for (const agent of AGENTS) {
    if (selectedNames.size > 0 && !selectedNames.has(agent.name)) continue;
    const rawEnv = loadAgentEnv(agent);
    const privateKey = normalizePrivateKey(rawEnv.EXTERNAL_PRIVATE_KEY);
    const agentName = rawEnv.AGENT_NAME || agent.name;
    const rpcUrl = rawEnv.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network/";

    if (!privateKey) {
      rows.push({
        agent,
        agentName,
        status: "blocked",
        reason: "missing or invalid EXTERNAL_PRIVATE_KEY",
      });
      continue;
    }

    const account = privateKeyToAccount(privateKey);
    const row = {
      agent,
      agentName,
      account: account.address,
      keyFingerprint: fingerprint(privateKey),
      rpcUrl,
      status: "ready",
      reason: "",
      duplicateWith: null,
      registered: false,
      configId: null,
      existingName: null,
      nameTaken: false,
    };

    const first = byAddress.get(account.address);
    if (first) {
      row.status = "blocked";
      row.duplicateWith = first.agent.name;
      row.reason = `shares registrant ${account.address} with ${first.agent.name}`;
    } else {
      byAddress.set(account.address, row);
    }

    if (!isValidAgentName(agentName)) {
      row.status = "blocked";
      row.reason = row.reason
        ? `${row.reason}; invalid on-chain AGENT_NAME=${agentName}`
        : `invalid on-chain AGENT_NAME=${agentName}`;
    }

    rows.push(row);
  }

  for (const row of rows) {
    if (!row.account) continue;
    const registered = await registry.read.isRegisteredExternal([row.account]);
    row.registered = registered;
    if (registered) {
      const existing = registrationsByRegistrant.get(row.account.toLowerCase());
      if (existing) {
        row.configId = existing.configId;
        row.existingName = existing.name;
        if (existing.name !== row.agentName) {
          row.status = "blocked";
          row.reason = row.reason
            ? `${row.reason}; registrant already bound on-chain to ${existing.name}`
            : `registrant already bound on-chain to ${existing.name}`;
        }
      }
    }

    const resolved = await twiinNames.read.resolve([row.agentName]);
    if (resolved[0] !== 0n) {
      row.nameTaken = true;
      if (row.existingName !== row.agentName) {
        row.status = "blocked";
        row.reason = row.reason
          ? `${row.reason}; name already claimed in TwiinNames`
          : "name already claimed in TwiinNames";
      }
    }
  }

  return rows;
}

function printAudit(rows) {
  for (const row of rows) {
    const parts = [`[${row.status}]`, row.agent.name, `name=${row.agentName}`];
    if (row.account) parts.push(`registrant=${row.account}`);
    if (row.keyFingerprint) parts.push(`key=${row.keyFingerprint}`);
    if (row.registered) {
      parts.push(`onchain=configId:${row.configId == null ? "unknown" : row.configId.toString()}`);
      if (row.existingName) parts.push(`registeredName=${row.existingName}`);
    } else {
      parts.push("onchain=unregistered");
    }
    if (row.nameTaken) parts.push("name=taken");
    if (row.reason) parts.push(`reason=${row.reason}`);
    console.log(parts.join(" "));
  }
}

function runRegister(agent) {
  const result = spawnSync("pnpm", ["--filter", agent.packageName, "register:somnia"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`registration failed for ${agent.name}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await buildAuditRows(args.selected);
  printAudit(rows);

  if (!args.register) return;

  const blocked = rows.filter((row) => row.status === "blocked");
  if (blocked.length > 0) {
    process.exitCode = 1;
    console.error(`blocked ${blocked.length} agent(s); fix audit issues before registering`);
    return;
  }

  for (const row of rows) {
    runRegister(row.agent);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
