import { Hono } from "hono";
import { capabilityNameById } from "../contracts";
import { listExternalAgents } from "../db";

export type AgentsRouterDeps = {
  listExternalAgents: typeof listExternalAgents;
  capabilityNameById: Map<string, string>;
};

export function createAgentsRouter(
  overrides: Partial<AgentsRouterDeps> = {},
): Hono {
  const deps: AgentsRouterDeps = {
    listExternalAgents,
    capabilityNameById,
    ...overrides,
  };
  const router = new Hono();

  router.get("/", async (c) => {
    const verifiedOnly = c.req.query("verified") === "true";
    const agents = await deps.listExternalAgents({ verifiedOnly });

    return c.json({
      agents: agents.map((agent) => ({
        ...agent,
        capabilityNames: agent.capabilities.map(
          (cap) => deps.capabilityNameById.get(cap.toLowerCase()) ?? cap,
        ),
      })),
    });
  });

  return router;
}
