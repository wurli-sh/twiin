const AGENT_PORTS = [3011, 3012, 3013, 3014, 3015, 3016, 8790];
const POLL_MS = 500;
const TIMEOUT_MS = 30_000;

async function isHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;
  console.log("[dev:all] waiting for external agents to become healthy...");

  while (Date.now() < deadline) {
    const results = await Promise.all(AGENT_PORTS.map(isHealthy));
    const ready = results.filter(Boolean).length;
    if (ready === AGENT_PORTS.length) {
      console.log("[dev:all] all external agents healthy, starting backend");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  console.warn(
    `[dev:all] timed out after ${TIMEOUT_MS / 1000}s waiting for agents; starting backend anyway`,
  );
}

main().catch((error) => {
  console.error("[dev:all] agent wait failed:", error);
  process.exit(1);
});
