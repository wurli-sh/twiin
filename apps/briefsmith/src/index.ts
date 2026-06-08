import { createExternalApp, startExternalServer } from "@twiin/external-kit";
import { loadEnv } from "./env";
import { executeBriefsmith } from "./handler";

const env = loadEnv();
const app = createExternalApp({
  env,
  capabilityNames: ["data.specialized"],
  execute: executeBriefsmith,
});

startExternalServer(app, env);
