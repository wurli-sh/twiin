import { createExternalApp, startExternalServer } from "@twiin/external-kit";
import { loadEnv } from "./env";
import { executeReactivityLens } from "./handler";

const env = loadEnv();
const app = createExternalApp({
  env,
  capabilityNames: ["data.specialized"],
  execute: executeReactivityLens,
});

startExternalServer(app, env);
