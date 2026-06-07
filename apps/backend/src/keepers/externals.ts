import { parseAbiItem, type AbiEvent } from "viem";
import { publicClient } from "../clients";
import { addresses, defaultStartBlock } from "../contracts";
import {
  deactivateExternalAgent,
  getExternalAgent,
  listExternalAgents,
  upsertExternalAgent,
} from "../db";
import { env } from "../env";
import { verifyExternalAgentCacheEntry } from "./relay";

const CHUNK = 500n;
const HEALTH_REFRESH_MS = 5 * 60 * 1000;

const externalAgentRegisteredEvent = parseAbiItem(
  "event ExternalAgentRegistered(uint256 indexed configId, address indexed registrant, string endpointUrl, bytes32 endpointHash, bytes32[] caps, uint256 costWei)",
) as AbiEvent;
const externalEndpointUpdatedEvent = parseAbiItem(
  "event ExternalEndpointUpdated(uint256 indexed configId, string newUrl, bytes32 newHash)",
) as AbiEvent;
const externalDeregisteredEvent = parseAbiItem(
  "event ExternalDeregistered(uint256 indexed configId, address indexed registrant)",
) as AbiEvent;

type RegistryLogArgs = Record<
  string,
  bigint | string | `0x${string}` | `0x${string}`[] | null | undefined
>;

type ExternalBootstrapDeps = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ args: RegistryLogArgs }>>;
  addresses: { agentRegistry: `0x${string}` };
  startBlock: bigint;
  getExternalAgent: typeof getExternalAgent;
  upsertExternalAgent: typeof upsertExternalAgent;
  deactivateExternalAgent: typeof deactivateExternalAgent;
  listExternalAgents: typeof listExternalAgents;
  logger: Pick<Console, "log" | "warn" | "error">;
};

export function createExternalAgentBootstrap(
  overrides: Partial<ExternalBootstrapDeps> = {},
) {
  const deps: ExternalBootstrapDeps = {
    getBlockNumber: () => publicClient.getBlockNumber(),
    getLogs: (args) =>
      publicClient.getLogs(args) as Promise<Array<{ args: RegistryLogArgs }>>,
    addresses: { agentRegistry: addresses.agentRegistry },
    startBlock: env.START_BLOCK ?? defaultStartBlock,
    getExternalAgent,
    upsertExternalAgent,
    deactivateExternalAgent,
    listExternalAgents,
    logger: console,
    ...overrides,
  };

  return {
    async run(): Promise<void> {
      const latest = await deps.getBlockNumber();
      let from = deps.startBlock;

      while (from <= latest) {
        const to = from + CHUNK < latest ? from + CHUNK : latest;
        await processRange(deps, from, to);
        from = to + 1n;
      }

      await verifyUnverifiedAgents(deps);
    },
  };
}

export function startExternalHealthRefresh(
  overrides: Partial<ExternalBootstrapDeps> = {},
): void {
  const bootstrap = createExternalAgentBootstrap(overrides);
  const tick = async () => {
    try {
      const agents = await listExternalAgents({ activeOnly: true });
      for (const agent of agents) {
        const ok = await verifyExternalAgentCacheEntry(agent.config_id);
        if (!ok) {
          console.warn(
            `[externals] health refresh failed for config=${agent.config_id}`,
          );
        }
      }
    } catch (error) {
      console.error("[externals] health refresh error:", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, HEALTH_REFRESH_MS);
}

async function verifyUnverifiedAgents(
  deps: ExternalBootstrapDeps,
): Promise<void> {
  const activeAgents = await deps.listExternalAgents({ activeOnly: true });
  for (const agent of activeAgents) {
    if (agent.is_verified === 1) continue;
    const ok = await verifyExternalAgentCacheEntry(agent.config_id);
    if (!ok) {
      deps.logger.warn(
        `[externals] boot verification failed for config=${agent.config_id}`,
      );
    }
  }
}

async function processRange(
  deps: ExternalBootstrapDeps,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<void> {
  const load = (event: AbiEvent) =>
    deps.getLogs({
      address: deps.addresses.agentRegistry,
      event,
      fromBlock,
      toBlock,
    });

  for (const log of await load(externalAgentRegisteredEvent)) {
    const { configId, registrant, endpointUrl, endpointHash, caps } = log.args;
    if (
      configId == null ||
      registrant == null ||
      typeof endpointUrl !== "string" ||
      endpointHash == null
    ) {
      continue;
    }
    await deps.upsertExternalAgent(
      configId.toString(),
      registrant.toString(),
      endpointUrl,
      endpointHash.toString(),
      normalizeCapabilities(caps),
    );
  }

  for (const log of await load(externalEndpointUpdatedEvent)) {
    const { configId, newUrl, newHash } = log.args;
    if (configId == null || typeof newUrl !== "string" || newHash == null) {
      continue;
    }
    const agent = await deps.getExternalAgent(configId.toString());
    if (!agent) continue;
    await deps.upsertExternalAgent(
      configId.toString(),
      agent.registrant,
      newUrl,
      newHash.toString(),
      agent.capabilities,
    );
  }

  for (const log of await load(externalDeregisteredEvent)) {
    const { configId } = log.args;
    if (configId == null) continue;
    await deps.deactivateExternalAgent(configId.toString());
  }
}

function normalizeCapabilities(
  caps: `0x${string}`[] | bigint | string | `0x${string}` | null | undefined,
): string[] {
  return Array.isArray(caps)
    ? caps.filter((value): value is `0x${string}` => typeof value === "string")
    : [];
}
