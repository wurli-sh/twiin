import { createExternalApp, startExternalServer } from "@twiin/external-kit";
import { loadEnv } from "./env";
import { executeReceiptAuditor } from "./handler";

const env = loadEnv();
const app = createExternalApp({
  env,
  capabilityNames: ["data.specialized"],
  execute: executeReceiptAuditor,
});

startExternalServer(app, env);
