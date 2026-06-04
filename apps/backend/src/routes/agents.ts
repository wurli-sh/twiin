import { Hono } from "hono";
import { capabilityNameById, agentRegistryContract } from "../contracts";
import { listExternalAgents } from "../db";

export type AgentsRouterDeps = {
  readNextConfigId: () => Promise<bigint>;
  readAgent: (configId: bigint) => Promise<{
    name: string;
    lane: number;
    capabilities: readonly `0x${string}`[];
    costWei: bigint;
    eloScore: bigint;
    isActive: boolean;
    tasksCompleted: bigint;
    tasksFailed: bigint;
    avgLatencyMs: number;
    trustTier: number;
    somniaAgentId: bigint;
    registrant: `0x${string}`;
    endpointHash: `0x${string}`;
    depositWei: bigint;
    suspended: boolean;
  }>;
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
};

export function createAgentsRouter(
  overrides: Partial<AgentsRouterDeps> = {},
): Hono {
  const deps: AgentsRouterDeps = {
    readNextConfigId: () => agentRegistryContract.read.nextConfigId(),
    readAgent: (configId) => agentRegistryContract.read.get([configId]),
    listExternalAgents,
    capabilityNameById,
    ...overrides,
  };
  const router = new Hono();

  router.get("/", async (c) => {
    const activeOnly = c.req.query("active") !== "false";
    const verifiedOnly = c.req.query("verified") === "true";
    const cachedExternals = await deps.listExternalAgents({
      activeOnly,
      verifiedOnly,
    });
    const externalByConfigId = new Map(
      cachedExternals.map((agent) => [agent.config_id, agent] as const),
    );
    const nextConfigId = await deps.readNextConfigId();
    const chainAgents = await Promise.all(
      Array.from({ length: Number(nextConfigId) }, (_, index) =>
        deps.readAgent(BigInt(index)),
      ),
    );

    const agents = chainAgents
      .map((agent, index) => {
        if (!agent.name) return null;
        if (activeOnly && !agent.isActive) return null;
        const configId = index.toString();
        const external = externalByConfigId.get(configId);
        const capabilities = agent.capabilities.map((cap) => cap.toLowerCase());
        return {
          configId: index,
          name: agent.name,
          lane: agent.lane === 0 ? "SomniaNative" : "ExternalHTTP",
          costWei: agent.costWei.toString(),
          eloScore: Number(agent.eloScore),
          isActive: agent.isActive,
          suspended: agent.suspended,
          tasksCompleted: Number(agent.tasksCompleted),
          tasksFailed: Number(agent.tasksFailed),
          avgLatencyMs: Number(agent.avgLatencyMs),
          trustTier: Number(agent.trustTier),
          capabilities,
          capabilityNames: capabilities.map(
            (cap) => deps.capabilityNameById.get(cap.toLowerCase()) ?? cap,
          ),
          somniaAgentId:
            agent.somniaAgentId > 0n ? agent.somniaAgentId.toString() : null,
          registrant: agent.registrant,
          endpointHash: agent.endpointHash,
          depositWei: agent.depositWei.toString(),
          endpointUrl: external?.endpoint_url ?? null,
          isVerified: external?.is_verified === 1,
          lastVerifiedAt: external?.last_verified_at ?? null,
          lastError: external?.last_error ?? null,
          updatedAt: external?.updated_at ?? null,
        };
      })
      .filter((agent) => agent !== null)
      .filter((agent) => {
        if (!verifiedOnly) return true;
        return agent.lane !== "ExternalHTTP" || agent.isVerified;
      });

    return c.json({
      agents,
    });
  });

  return router;
}
