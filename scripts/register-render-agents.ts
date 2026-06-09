import { loadBaseEnv, registerExternalAgent } from "../packages/external-kit/src";

const AGENTS = [
  { name: "docs-lens", urlKey: "DOCS_LENS_URL", costStt: "0.15" },
  { name: "dreamdex-mcp", urlKey: "DREAMDEX_MCP_URL", costStt: "0.20" },
  { name: "onchain-lens", urlKey: "ONCHAIN_LENS_URL", costStt: "0.16" },
  { name: "receipt-auditor", urlKey: "RECEIPT_AUDITOR_URL", costStt: "0.14" },
  { name: "briefsmith", urlKey: "BRIEFSMITH_URL", costStt: "0.22" },
  { name: "reactivity-lens", urlKey: "REACTIVITY_LENS_URL", costStt: "0.17" },
  { name: "agent-adapter", urlKey: "AGENT_ADAPTER_URL", costStt: "0.20" },
] as const;

async function main(): Promise<void> {
  if (!process.env.EXTERNAL_PRIVATE_KEY) {
    console.error("Set EXTERNAL_PRIVATE_KEY in scripts/register-render-agents.env.local");
    process.exit(1);
  }

  let updated = 0;
  for (const agent of AGENTS) {
    const publicUrl = process.env[agent.urlKey]?.trim();
    if (!publicUrl) {
      console.warn(`[skip] ${agent.name}: ${agent.urlKey} not set`);
      continue;
    }

    const env = loadBaseEnv(process.env, {
      AGENT_NAME: agent.name,
      AGENT_COST_STT: agent.costStt,
      EXTERNAL_PUBLIC_URL: publicUrl,
    });
    await registerExternalAgent(env, []);
    updated++;
  }

  console.log(`\nDone. ${updated} agent endpoint(s) registered or updated on-chain.`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
