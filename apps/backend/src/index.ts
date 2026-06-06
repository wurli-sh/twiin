import { serve } from "@hono/node-server";
import { env } from "./env";
import { createApp } from "./app";
import { keeperAccount } from "./clients";
import { ensureSchema } from "./db";
import { startIndexer } from "./keepers/indexer";
import { startRelay } from "./keepers/relay";
import { startRater } from "./keepers/rater";
import { startTimeoutKeeper } from "./keepers/timeouts";
import { createExternalAgentBootstrap } from "./keepers/externals";
import { startTrustlessResumeKeeper } from "./keepers/trustless-resume";

const app = createApp();

async function bootstrap(): Promise<void> {
  await ensureSchema();

  const dbMode = env.TURSO_DB_URL.startsWith("file:")
    ? `local (${env.TURSO_DB_URL})`
    : "remote Turso";
  console.log(`[twiin-backend] database: ${dbMode}`);

  if (!env.PLAN_SECRET) {
    console.warn(
      "[twiin-backend] WARNING: PLAN_SECRET is not set — POST /api/plan is unauthenticated. Set PLAN_SECRET in production.",
    );
  }

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[twiin-backend] listening on http://localhost:${info.port}`);
    console.log(`[twiin-backend] keeper address: ${keeperAccount.address}`);
    console.log(`[twiin-backend] keepers enabled: ${env.RUN_KEEPERS}`);
  });

  if (env.RUN_KEEPERS) {
    startIndexer();
    startRelay();
    startRater();
    startTimeoutKeeper();
    if (env.ENABLE_TRUSTLESS_JANICE) {
      startTrustlessResumeKeeper();
    }
    void createExternalAgentBootstrap()
      .run()
      .then(() => {
        console.log("[twiin-backend] external-agent bootstrap complete");
      })
      .catch((error) => {
        console.error("[twiin-backend] external-agent bootstrap failed:", error);
      });
  }
}

void bootstrap().catch((err) => {
  console.error("[twiin-backend] bootstrap failed:", err);
  process.exit(1);
});
