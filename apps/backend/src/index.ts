import { serve } from "@hono/node-server";
import { env } from "./env";
import { createApp } from "./app";
import { keeperAccount } from "./clients";
import { ensureSchema } from "./db";
import { startIndexer } from "./keepers/indexer";
import { startRelay } from "./keepers/relay";
import { startRater } from "./keepers/rater";

const app = createApp();

async function bootstrap(): Promise<void> {
  await ensureSchema();

  if (!env.PLAN_SECRET) {
    console.warn(
      "[twiin-backend] WARNING: PLAN_SECRET is not set — POST /api/plan is unauthenticated. Set PLAN_SECRET in production.",
    );
  }

  if (env.RUN_KEEPERS) {
    startIndexer();
    startRelay();
    startRater();
  }

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[twiin-backend] listening on http://localhost:${info.port}`);
    console.log(`[twiin-backend] keeper address: ${keeperAccount.address}`);
    console.log(`[twiin-backend] keepers enabled: ${env.RUN_KEEPERS}`);
  });
}

void bootstrap().catch((err) => {
  console.error("[twiin-backend] bootstrap failed:", err);
  process.exit(1);
});
