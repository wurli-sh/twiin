import { createExternalApp, startExternalServer } from "@twiin/external-kit";
import { loadEnv } from "./env";
import { executeOnchainLens } from "./handler";

const env = loadEnv();
const app = createExternalApp({
  env,
  capabilityNames: ["data.specialized"],
  execute: executeOnchainLens,
});

startExternalServer(app, env);
