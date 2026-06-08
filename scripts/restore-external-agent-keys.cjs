const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

/** Dev-only keys that match on-chain registrants for Somnia testnet. */
const AGENT_KEYS = {
  "apps/docs-lens/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/reactivity-lens/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/dreamdex-mcp/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/onchain-lens/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/receipt-auditor/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/briefsmith/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
  "apps/agent-adapter/.env.local":
    "a807affc7b29c60912092bf0232a192950471bcecb9cb867c54b6fd091acf09b",
};

const sharedRoot = path.join(repoRoot, ".env.external-agents.local");
if (fs.existsSync(sharedRoot)) {
  const lines = fs
    .readFileSync(sharedRoot, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("EXTERNAL_PRIVATE_KEY="));
  fs.writeFileSync(sharedRoot, `${lines.join("\n").trim()}\n`);
}

for (const [relPath, privateKey] of Object.entries(AGENT_KEYS)) {
  const filePath = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `EXTERNAL_PRIVATE_KEY=${privateKey}\n`);
  console.log(`[restore-keys] wrote ${relPath}`);
}

console.log("[restore-keys] done — restart pnpm dev:all to re-verify agents");
