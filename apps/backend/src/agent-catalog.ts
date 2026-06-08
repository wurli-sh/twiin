import { formatEther } from "viem";
import {
  AgentLane,
  CapabilityId,
  isExternalHealthy,
  laneLabel,
  NATIVE_CONFIG_CAPABILITIES,
  pickSubstitute,
  RESERVED_CONFIG_IDS,
  resolveByCapability,
  type AgentCandidate,
} from "@twiin/shared";
import { publicClient } from "./clients";
import {
  agentRegistryContract,
  capabilityNameById,
  deployment,
} from "./contracts";
import { listExternalAgents } from "./db";

const HEALTH_TTL_SECONDS = 300;

export type AgentCatalogDeps = {
  readNextConfigId: () => Promise<bigint>;
  readAgent: (configId: bigint) => Promise<{
    name: string;
    lane: number;
    capabilities?: readonly `0x${string}`[];
    costWei: bigint;
    isActive: boolean;
    suspended: boolean;
  }>;
  readRequestDeposit: () => Promise<bigint>;
  readByCapability: (cap: `0x${string}`) => Promise<readonly bigint[]>;
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
  nowSeconds?: () => number;
};

async function defaultReadRequestDeposit(): Promise<bigint> {
  return publicClient.readContract({
    address: deployment.agentsApi as `0x${string}`,
    abi: [
      {
        type: "function",
        name: "getRequestDeposit",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getRequestDeposit",
  });
}

export class AgentCatalog {
  private cache: AgentCandidate[] | null = null;
  private cacheAt = 0;
  private readonly cacheMs = 30_000;

  constructor(private readonly deps: AgentCatalogDeps) {}

  async loadCandidates(force = false): Promise<AgentCandidate[]> {
    const now = Date.now();
    if (!force && this.cache && now - this.cacheAt < this.cacheMs) {
      return this.cache;
    }
    this.cache = await this.buildCandidates();
    this.cacheAt = now;
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  async getAgentsForPlanner(): Promise<AgentCandidate[]> {
    const candidates = await this.loadCandidates();
    return candidates.filter(
      (c) =>
        c.healthy &&
        c.isActive &&
        !c.suspended &&
        !RESERVED_CONFIG_IDS.has(c.configId),
    );
  }

  async resolveByCapability(
    capability: string,
    budgetWei: bigint,
  ): Promise<AgentCandidate[]> {
    const candidates = await this.loadCandidates();
    return resolveByCapability(candidates, capability, budgetWei);
  }

  async substitute(
    configId: number,
    budgetWei: bigint,
    exclude: Set<number> = new Set(),
  ): Promise<AgentCandidate | null> {
    const candidates = await this.loadCandidates();
    return pickSubstitute(candidates, configId, budgetWei, exclude);
  }

  async renderPlannerContext(): Promise<string> {
    const agents = await this.getAgentsForPlanner();
    if (agents.length === 0) return "";

    return agents
      .map((agent) => {
        const caps =
          agent.capabilityNames.length > 0
            ? ` capabilities=${agent.capabilityNames.join(", ")}.`
            : "";
        const kind =
          agent.lane === "external" ? "external HTTP agent" : "native agent";
        return `- configId ${agent.configId} (${agent.name}): ${kind}. cost=${formatEther(agent.exactCostWei)} STT.${caps}`;
      })
      .join("\n");
  }

  private async buildCandidates(): Promise<AgentCandidate[]> {
    const nowSeconds = this.deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    const nextConfigId = await this.deps.readNextConfigId();
    const requestDeposit = await this.deps.readRequestDeposit();

    let externalRows: Awaited<ReturnType<typeof listExternalAgents>> = [];
    try {
      externalRows = await this.deps.listExternalAgents({ activeOnly: true });
    } catch {
      /* non-fatal */
    }
    const externalById = new Map(
      externalRows.map((row) => [row.config_id, row] as const),
    );

    const rankByConfig = new Map<number, number>();
    for (const cap of Object.values(CapabilityId)) {
      try {
        const ranked = await this.deps.readByCapability(cap as `0x${string}`);
        ranked.forEach((id, index) => {
          const num = Number(id);
          if (!rankByConfig.has(num)) rankByConfig.set(num, index);
        });
      } catch {
        /* skip capability read failures */
      }
    }

    const out: AgentCandidate[] = [];
    for (let id = 0; id < Number(nextConfigId); id++) {
      if (RESERVED_CONFIG_IDS.has(id)) continue;
      try {
        const agent = await this.deps.readAgent(BigInt(id));
        if (!agent.name) continue;

        const external = externalById.get(String(id));
        const caps =
          (agent.capabilities?.length ?? 0) > 0
            ? agent.capabilities!.map((c) => c.toLowerCase())
            : NATIVE_CONFIG_CAPABILITIES[id]
              ? [NATIVE_CONFIG_CAPABILITIES[id].toLowerCase()]
              : [];

        const isNative = agent.lane === AgentLane.SomniaNative;
        const exactCostWei = isNative
          ? requestDeposit + agent.costWei * 3n
          : agent.costWei;

        const healthy = isExternalHealthy({
          lane: agent.lane,
          isVerified: external?.is_verified === 1,
          lastVerifiedAt: external?.last_verified_at ?? null,
          nowSeconds,
          healthTtlSeconds: HEALTH_TTL_SECONDS,
        });

        out.push({
          configId: id,
          lane: laneLabel(agent.lane),
          name: agent.name,
          exactCostWei,
          capabilities: caps,
          capabilityNames: caps.map(
            (cap) => this.deps.capabilityNameById.get(cap) ?? cap,
          ),
          healthy: isNative ? agent.isActive && !agent.suspended : healthy,
          rank: rankByConfig.get(id) ?? 999,
          isActive: agent.isActive,
          suspended: agent.suspended,
        });
      } catch {
        /* skip unavailable agents */
      }
    }

    return out.sort((a, b) => a.configId - b.configId);
  }
}

let defaultCatalog: AgentCatalog | null = null;

export function getAgentCatalog(
  overrides: Partial<AgentCatalogDeps> = {},
): AgentCatalog {
  if (Object.keys(overrides).length > 0) {
    return new AgentCatalog({
      readNextConfigId: () => agentRegistryContract.read.nextConfigId(),
      readAgent: (configId) => agentRegistryContract.read.get([configId]),
      readRequestDeposit: defaultReadRequestDeposit,
      readByCapability: (cap) => agentRegistryContract.read.getByCapability([cap]),
      listExternalAgents,
      capabilityNameById,
      ...overrides,
    });
  }
  if (!defaultCatalog) {
    defaultCatalog = new AgentCatalog({
      readNextConfigId: () => agentRegistryContract.read.nextConfigId(),
      readAgent: (configId) => agentRegistryContract.read.get([configId]),
      readRequestDeposit: defaultReadRequestDeposit,
      readByCapability: (cap) => agentRegistryContract.read.getByCapability([cap]),
      listExternalAgents,
      capabilityNameById,
    });
  }
  return defaultCatalog;
}
