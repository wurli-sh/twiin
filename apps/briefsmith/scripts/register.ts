import { registerExternalAgent } from "@twiin/external-kit";
import { CapabilityId } from "@twiin/shared";
import { loadEnv } from "../src/env";

async function main() {
  await registerExternalAgent(loadEnv(), [CapabilityId.DATA_SPECIALIZED as `0x${string}`]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
