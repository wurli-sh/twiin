import { createExternalApp, startExternalServer } from "@twiin/external-kit";
import { loadEnv } from "./env";
import { executeAgentAdapter } from "./handler";

const env = loadEnv();
const app = createExternalApp({
  env,
  capabilityNames: ["data.specialized"],
  execute: executeAgentAdapter,
});

startExternalServer(app, env);
