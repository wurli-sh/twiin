import { ensureSchema } from "../src/db";
import { createExternalAgentBootstrap } from "../src/keepers/externals";

async function main(): Promise<void> {
  await ensureSchema();

  console.log("[verify-externals] syncing on-chain external-agent registry...");
  const summary = await createExternalAgentBootstrap().run();

  console.log(
    `\n[verify-externals] verified=${summary.verified} failed=${summary.failed}`,
  );
  process.exit(summary.failed > 0 ? 1 : 0);
}

void main().catch((error) => {
  console.error("[verify-externals] fatal:", error);
  process.exit(1);
});
