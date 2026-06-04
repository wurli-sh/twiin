import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();

serve(
  {
    fetch: createApp().fetch,
    hostname: env.HOST,
    port: env.PORT,
  },
  (info) => {
    console.log(
      `[discord-bot] listening on http://${env.HOST}:${info.port} as ${env.AGENT_NAME}`,
    );
  },
);
