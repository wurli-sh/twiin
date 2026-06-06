import { drizzle } from "drizzle-orm/libsql";
import { and, eq, inArray, sql } from "drizzle-orm";
import { StepState, TaskState } from "@twiin/shared";
import * as schema from "./schema";
import {
  externalAgents,
  keeperCursors,
  planRequests,
  steps,
  submittedRatings,
  submittedResults,
  tasks,
} from "./schema";
import { env } from "./env";

export const db = drizzle({
  connection: {
    url: env.TURSO_DB_URL,
    authToken: env.TURSO_AUTH_TOKEN || undefined,
  },
  schema,
});

let schemaReady: Promise<void> | null = null;

async function ensureColumn(
  table: string,
  _column: string,
  definition: string,
): Promise<void> {
  try {
    await db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${definition}`));
  } catch (error) {
    const detail = `${String(error)} ${String((error as { cause?: unknown }).cause ?? "")}`;
    if (!detail.includes("duplicate column name")) {
      throw error;
    }
  }
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS keeper_cursors (
          name text PRIMARY KEY NOT NULL,
          block integer NOT NULL DEFAULT 0
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id text PRIMARY KEY NOT NULL,
          personal_agent_id text NOT NULL,
          mode integer NOT NULL DEFAULT 0,
          budget_wei text NOT NULL,
          state integer NOT NULL DEFAULT 0,
          cursor integer NOT NULL DEFAULT 0,
          deadline integer NOT NULL DEFAULT 0,
          created_at integer NOT NULL
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS steps (
          task_id text NOT NULL,
          step_idx integer NOT NULL,
          config_id text NOT NULL,
          timeout_seconds integer,
          state integer NOT NULL DEFAULT 0,
          payload text NOT NULL DEFAULT '',
          req_id text,
          result_hex text,
          score integer,
          deadline integer,
          updated_at integer NOT NULL,
          PRIMARY KEY (task_id, step_idx)
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS submitted_results (
          task_id text NOT NULL,
          step_idx integer NOT NULL,
          result_hex text NOT NULL,
          sig text NOT NULL,
          submitted_at integer NOT NULL,
          PRIMARY KEY (task_id, step_idx)
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS submitted_ratings (
          task_id text NOT NULL,
          step_idx integer NOT NULL,
          score integer NOT NULL,
          submitted_at integer NOT NULL,
          PRIMARY KEY (task_id, step_idx)
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS plan_requests (
          id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          personal_agent_id text NOT NULL,
          goal text NOT NULL,
          steps_json text NOT NULL,
          budget_wei text NOT NULL,
          created_at integer NOT NULL
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS external_agents (
          config_id text PRIMARY KEY NOT NULL,
          registrant text NOT NULL,
          endpoint_url text NOT NULL,
          endpoint_hash text NOT NULL,
          capabilities_json text NOT NULL DEFAULT '[]',
          is_active integer NOT NULL DEFAULT 1,
          is_verified integer NOT NULL DEFAULT 0,
          last_verified_at integer,
          last_error text,
          updated_at integer NOT NULL
        )
      `);
      await ensureColumn(
        "steps",
        "timeout_seconds",
        "timeout_seconds integer",
      );
      await ensureColumn(
        "external_agents",
        "capabilities_json",
        "capabilities_json text NOT NULL DEFAULT '[]'",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

// ── Cursors ──────────────────────────────────────────────────────────────────

export async function getCursor(name: string): Promise<bigint> {
  const [row] = await db
    .select({ block: keeperCursors.block })
    .from(keeperCursors)
    .where(eq(keeperCursors.name, name))
    .limit(1);
  return BigInt(row?.block ?? 0);
}

export async function setCursor(name: string, block: bigint): Promise<void> {
  await db
    .insert(keeperCursors)
    .values({ name, block: Number(block) })
    .onConflictDoUpdate({
      target: keeperCursors.name,
      set: { block: Number(block) },
    });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function upsertTask(
  taskId: string,
  personalAgentId: string,
  mode: number,
  budgetWei: string,
  state: number,
  cursor: number,
  deadline: number,
  createdAt: number,
): Promise<void> {
  await db
    .insert(tasks)
    .values({
      taskId,
      personalAgentId,
      mode,
      budgetWei,
      state,
      cursor,
      deadline,
      createdAt,
    })
    .onConflictDoUpdate({
      target: tasks.taskId,
      set: { state, cursor },
    });
}

export async function updateTaskState(
  taskId: string,
  state: number,
): Promise<void> {
  await db.update(tasks).set({ state }).where(eq(tasks.taskId, taskId));
}

export async function finalizeTaskSteps(
  taskId: string,
  terminalState: number,
): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .update(steps)
    .set({
      state: terminalState,
      deadline: null,
      updatedAt,
    })
    .where(
      and(
        eq(steps.taskId, taskId),
        inArray(steps.state, [
          StepState.Pending,
          StepState.RunningNative,
          StepState.RunningExternal,
          StepState.AwaitingRating,
          StepState.Retrying,
        ]),
      ),
    );
}

// ── Steps ─────────────────────────────────────────────────────────────────────

/** Drop advisory step rows when a task id is reused after redeploy (Turso survives redeploys). */
export async function deleteStepsForTask(taskId: string): Promise<void> {
  await db.delete(steps).where(eq(steps.taskId, taskId));
}

export async function upsertStep(
  taskId: string,
  stepIdx: number,
  configId: string,
  timeoutSeconds: number | null,
  state: number,
  payload: string,
  reqId: string | null,
  resultHex: string | null,
  score: number | null,
  deadline: number | null,
): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(steps)
    .values({
      taskId,
      stepIdx,
      configId,
      timeoutSeconds,
      state,
      payload,
      reqId,
      resultHex,
      score,
      deadline,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [steps.taskId, steps.stepIdx],
      set: {
        state: sql`excluded.state`,
        // Preserve non-empty/non-zero values already stored
        configId: sql`COALESCE(NULLIF(excluded.config_id, '0'), config_id)`,
        timeoutSeconds: sql`COALESCE(excluded.timeout_seconds, timeout_seconds)`,
        payload: sql`COALESCE(NULLIF(excluded.payload, ''), payload)`,
        reqId: sql`COALESCE(excluded.req_id, req_id)`,
        resultHex: sql`COALESCE(excluded.result_hex, result_hex)`,
        score: sql`COALESCE(excluded.score, score)`,
        deadline: sql`COALESCE(excluded.deadline, deadline)`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function getStep(
  taskId: string,
  stepIdx: number,
): Promise<{
  config_id: string;
  timeout_seconds: number | null;
  state: number;
  payload: string;
  req_id: string | null;
  result_hex: string | null;
  score: number | null;
} | null> {
  const [row] = await db
    .select({
      config_id: steps.configId,
      timeout_seconds: steps.timeoutSeconds,
      state: steps.state,
      payload: steps.payload,
      req_id: steps.reqId,
      result_hex: steps.resultHex,
      score: steps.score,
    })
    .from(steps)
    .where(and(eq(steps.taskId, taskId), eq(steps.stepIdx, stepIdx)))
    .limit(1);
  return row ?? null;
}

export async function getStepsForTask(taskId: string): Promise<
  {
    step_idx: number;
    config_id: string;
    timeout_seconds: number | null;
    state: number;
    payload: string;
    req_id: string | null;
    result_hex: string | null;
    score: number | null;
    deadline: number | null;
  }[]
> {
  const rows = await db
    .select({
      step_idx: steps.stepIdx,
      config_id: steps.configId,
      timeout_seconds: steps.timeoutSeconds,
      state: steps.state,
      payload: steps.payload,
      req_id: steps.reqId,
      result_hex: steps.resultHex,
      score: steps.score,
      deadline: steps.deadline,
    })
    .from(steps)
    .where(eq(steps.taskId, taskId))
    .orderBy(steps.stepIdx);
  return rows;
}

export async function getTimedOutSteps(
  nowSeconds: number,
): Promise<
  {
    task_id: string;
    step_idx: number;
    state: number;
    deadline: number | null;
  }[]
> {
  return db
    .select({
      task_id: steps.taskId,
      step_idx: steps.stepIdx,
      state: steps.state,
      deadline: steps.deadline,
    })
    .from(steps)
    .innerJoin(tasks, eq(tasks.taskId, steps.taskId))
    .where(
      and(
        eq(tasks.state, TaskState.Running),
        sql`${steps.deadline} IS NOT NULL AND ${steps.deadline} <= ${nowSeconds}`,
        inArray(steps.state, [
          StepState.RunningNative,
          StepState.RunningExternal,
          StepState.AwaitingRating,
        ]),
      ),
    );
}

// ── Submitted results dedup ───────────────────────────────────────────────────

export async function isResultSubmitted(
  taskId: string,
  stepIdx: number,
): Promise<boolean> {
  const [row] = await db
    .select({ taskId: submittedResults.taskId })
    .from(submittedResults)
    .where(
      and(
        eq(submittedResults.taskId, taskId),
        eq(submittedResults.stepIdx, stepIdx),
      ),
    )
    .limit(1);
  return !!row;
}

export async function saveSubmittedResult(
  taskId: string,
  stepIdx: number,
  resultHex: string,
  sig: string,
): Promise<void> {
  await db
    .insert(submittedResults)
    .values({
      taskId,
      stepIdx,
      resultHex,
      sig,
      submittedAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

export async function deleteSubmittedResult(
  taskId: string,
  stepIdx: number,
): Promise<void> {
  await db
    .delete(submittedResults)
    .where(
      and(
        eq(submittedResults.taskId, taskId),
        eq(submittedResults.stepIdx, stepIdx),
      ),
    );
}

// ── Submitted ratings dedup ───────────────────────────────────────────────────

export async function isRatingSubmitted(
  taskId: string,
  stepIdx: number,
): Promise<boolean> {
  const [row] = await db
    .select({ taskId: submittedRatings.taskId })
    .from(submittedRatings)
    .where(
      and(
        eq(submittedRatings.taskId, taskId),
        eq(submittedRatings.stepIdx, stepIdx),
      ),
    )
    .limit(1);
  return !!row;
}

export async function saveSubmittedRating(
  taskId: string,
  stepIdx: number,
  score: number,
): Promise<void> {
  await db
    .insert(submittedRatings)
    .values({
      taskId,
      stepIdx,
      score,
      submittedAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

export async function deleteSubmittedRating(
  taskId: string,
  stepIdx: number,
): Promise<void> {
  await db
    .delete(submittedRatings)
    .where(
      and(
        eq(submittedRatings.taskId, taskId),
        eq(submittedRatings.stepIdx, stepIdx),
      ),
    );
}

// ── Plan requests ─────────────────────────────────────────────────────────────

export async function savePlanRequest(
  personalAgentId: string,
  goal: string,
  stepsJson: string,
  budgetWei: string,
): Promise<void> {
  await db.insert(planRequests).values({
    personalAgentId,
    goal,
    stepsJson,
    budgetWei,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

export async function upsertExternalAgent(
  configId: string,
  registrant: string,
  endpointUrl: string,
  endpointHash: string,
  capabilities: string[],
): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(externalAgents)
    .values({
      configId,
      registrant,
      endpointUrl,
      endpointHash,
      capabilitiesJson: JSON.stringify(capabilities),
      isActive: 1,
      isVerified: 0,
      lastVerifiedAt: null,
      lastError: null,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: externalAgents.configId,
      set: {
        registrant,
        endpointUrl,
        endpointHash,
        capabilitiesJson: JSON.stringify(capabilities),
        isActive: 1,
        isVerified: 0,
        lastVerifiedAt: null,
        lastError: null,
        updatedAt,
      },
    });
}

export async function setExternalAgentVerification(
  configId: string,
  verified: boolean,
  lastError: string | null,
): Promise<void> {
  await db
    .update(externalAgents)
    .set({
      isVerified: verified ? 1 : 0,
      lastVerifiedAt: verified ? Math.floor(Date.now() / 1000) : null,
      lastError,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(externalAgents.configId, configId));
}

export async function deactivateExternalAgent(configId: string): Promise<void> {
  await db
    .update(externalAgents)
    .set({
      isActive: 0,
      isVerified: 0,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(externalAgents.configId, configId));
}

export async function getExternalAgent(configId: string): Promise<{
  config_id: string;
  registrant: string;
  endpoint_url: string;
  endpoint_hash: string;
  capabilities: string[];
  is_active: number;
  is_verified: number;
  last_verified_at: number | null;
  last_error: string | null;
} | null> {
  const [row] = await db
    .select({
      config_id: externalAgents.configId,
      registrant: externalAgents.registrant,
      endpoint_url: externalAgents.endpointUrl,
      endpoint_hash: externalAgents.endpointHash,
      capabilities_json: externalAgents.capabilitiesJson,
      is_active: externalAgents.isActive,
      is_verified: externalAgents.isVerified,
      last_verified_at: externalAgents.lastVerifiedAt,
      last_error: externalAgents.lastError,
    })
    .from(externalAgents)
    .where(eq(externalAgents.configId, configId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    capabilities: parseCapabilities(row.capabilities_json),
  };
}

export async function listExternalAgents(
  options: { activeOnly?: boolean; verifiedOnly?: boolean } = {},
): Promise<
  {
    config_id: string;
    registrant: string;
    endpoint_url: string;
    endpoint_hash: string;
    capabilities: string[];
    is_active: number;
    is_verified: number;
    last_verified_at: number | null;
    last_error: string | null;
    updated_at: number;
  }[]
> {
  const predicates = [];
  if (options.activeOnly) predicates.push(eq(externalAgents.isActive, 1));
  if (options.verifiedOnly) predicates.push(eq(externalAgents.isVerified, 1));

  const selection = {
    config_id: externalAgents.configId,
    registrant: externalAgents.registrant,
    endpoint_url: externalAgents.endpointUrl,
    endpoint_hash: externalAgents.endpointHash,
    capabilities_json: externalAgents.capabilitiesJson,
    is_active: externalAgents.isActive,
    is_verified: externalAgents.isVerified,
    last_verified_at: externalAgents.lastVerifiedAt,
    last_error: externalAgents.lastError,
    updated_at: externalAgents.updatedAt,
  };

  const rows =
    predicates.length > 0
      ? await db
          .select(selection)
          .from(externalAgents)
          .where(and(...predicates))
          .orderBy(externalAgents.configId)
      : await db
          .select(selection)
          .from(externalAgents)
          .orderBy(externalAgents.configId);

  return rows.map((row) => ({
    ...row,
    capabilities: parseCapabilities(row.capabilities_json),
  }));
}

function parseCapabilities(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export async function listRunningTaskIds(): Promise<string[]> {
  const rows = await db
    .select({ taskId: tasks.taskId })
    .from(tasks)
    .where(eq(tasks.state, 1));
  return rows.map((row) => row.taskId);
}
