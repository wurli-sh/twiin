import { drizzle } from "drizzle-orm/libsql";
import { and, eq, inArray, sql } from "drizzle-orm";
import { StepState, TaskState, TrustlessAwaiting } from "@twiin/shared";
import * as schema from "./schema";
import {
  externalAgents,
  keeperCursors,
  planRequests,
  relayJobs,
  steps,
  submittedRatings,
  submittedResults,
  tasks,
  trustlessTasks,
  trustlessTurns,
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
        CREATE TABLE IF NOT EXISTS trustless_tasks (
          task_id text PRIMARY KEY NOT NULL,
          goal text NOT NULL,
          intent_hash text NOT NULL,
          iterations integer NOT NULL DEFAULT 0,
          max_iterations integer NOT NULL DEFAULT 0,
          awaiting integer NOT NULL DEFAULT 0,
          janice_request_id text,
          last_resume_reason text,
          updated_at integer NOT NULL
        )
      `);
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS trustless_turns (
          task_id text NOT NULL,
          iteration integer NOT NULL,
          request_id text NOT NULL,
          finish_reason text NOT NULL,
          assistant_message text NOT NULL DEFAULT '',
          tool_calls_json text NOT NULL DEFAULT '[]',
          raw_result_hex text,
          transcript_hash text,
          created_at integer NOT NULL,
          PRIMARY KEY (task_id, iteration)
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
      await ensureColumn(
        "trustless_tasks",
        "last_resume_reason",
        "last_resume_reason text",
      );
      await ensureColumn(
        "tasks",
        "last_abort_reason",
        "last_abort_reason text",
      );
      await ensureColumn(
        "steps",
        "consensus_validators",
        "consensus_validators integer",
      );
      await ensureColumn(
        "steps",
        "consensus_receipt_id",
        "consensus_receipt_id text",
      );
      await ensureColumn(
        "steps",
        "consensus_median_cost_wei",
        "consensus_median_cost_wei text",
      );
      await ensureColumn("plan_requests", "plan_id", "plan_id text");
      await ensureColumn("plan_requests", "source", "source text NOT NULL DEFAULT 'llm'");
      await ensureColumn(
        "plan_requests",
        "attempts",
        "attempts integer NOT NULL DEFAULT 1",
      );
      await ensureColumn(
        "plan_requests",
        "verification_tier",
        "verification_tier text",
      );
      await ensureColumn(
        "plan_requests",
        "substitutions_json",
        "substitutions_json text",
      );
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS relay_jobs (
          task_id text NOT NULL,
          step_idx integer NOT NULL,
          config_id text NOT NULL,
          req_id text NOT NULL,
          payload text NOT NULL DEFAULT '0x',
          registrant text NOT NULL,
          endpoint_hash text NOT NULL,
          attempts integer NOT NULL DEFAULT 0,
          next_retry_at integer NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'pending',
          last_error text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          PRIMARY KEY (task_id, step_idx)
        )
      `);
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
  lastAbortReason?: string | null,
): Promise<void> {
  const next: { state: number; lastAbortReason?: string | null } = { state };
  if (lastAbortReason !== undefined) next.lastAbortReason = lastAbortReason;
  await db.update(tasks).set(next).where(eq(tasks.taskId, taskId));
}

export async function getTaskMeta(taskId: string): Promise<{
  last_abort_reason: string | null;
} | null> {
  const [row] = await db
    .select({
      last_abort_reason: tasks.lastAbortReason,
    })
    .from(tasks)
    .where(eq(tasks.taskId, taskId))
    .limit(1);
  return row ?? null;
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

export async function clearStepDeadline(
  taskId: string,
  stepIdx: number,
): Promise<void> {
  await db
    .update(steps)
    .set({
      deadline: null,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(and(eq(steps.taskId, taskId), eq(steps.stepIdx, stepIdx)));
}

// ── Steps ─────────────────────────────────────────────────────────────────────

/** Drop advisory step rows when a task id is reused after redeploy (Turso survives redeploys). */
export async function deleteStepsForTask(taskId: string): Promise<void> {
  await db.delete(steps).where(eq(steps.taskId, taskId));
}

/** Clear all task-scoped advisory/cache rows when a task id is reused after redeploy. */
export async function deleteTaskArtifactsForTask(taskId: string): Promise<void> {
  await db.delete(submittedRatings).where(eq(submittedRatings.taskId, taskId));
  await db.delete(submittedResults).where(eq(submittedResults.taskId, taskId));
  await db.delete(trustlessTurns).where(eq(trustlessTurns.taskId, taskId));
  await db.delete(trustlessTasks).where(eq(trustlessTasks.taskId, taskId));
  await deleteStepsForTask(taskId);
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

export async function patchStepConsensus(
  taskId: string,
  stepIdx: number,
  consensus: {
    validators: number;
    receiptId: string;
    medianCostWei: string;
  },
): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .update(steps)
    .set({
      consensusValidators: consensus.validators,
      consensusReceiptId: consensus.receiptId,
      consensusMedianCostWei: consensus.medianCostWei,
      updatedAt,
    })
    .where(and(eq(steps.taskId, taskId), eq(steps.stepIdx, stepIdx)));
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
    consensus_validators: number | null;
    consensus_receipt_id: string | null;
    consensus_median_cost_wei: string | null;
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
      consensus_validators: steps.consensusValidators,
      consensus_receipt_id: steps.consensusReceiptId,
      consensus_median_cost_wei: steps.consensusMedianCostWei,
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

export type PlanRequestSource = "llm" | "template" | "substituted";

export async function savePlanRequest(input: {
  planId: string;
  personalAgentId: string;
  goal: string;
  stepsJson: string;
  budgetWei: string;
  source?: PlanRequestSource;
  attempts?: number;
  verificationTier?: string | null;
  substitutionsJson?: string | null;
}): Promise<void> {
  await db.insert(planRequests).values({
    planId: input.planId,
    personalAgentId: input.personalAgentId,
    goal: input.goal,
    stepsJson: input.stepsJson,
    budgetWei: input.budgetWei,
    source: input.source ?? "llm",
    attempts: input.attempts ?? 1,
    verificationTier: input.verificationTier ?? null,
    substitutionsJson: input.substitutionsJson ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

export async function getPlanRequest(planId: string): Promise<{
  plan_id: string | null;
  personal_agent_id: string;
  goal: string;
  steps_json: string;
  budget_wei: string;
  source: string | null;
  attempts: number | null;
  verification_tier: string | null;
  substitutions_json: string | null;
  created_at: number;
} | null> {
  const [row] = await db
    .select({
      plan_id: planRequests.planId,
      personal_agent_id: planRequests.personalAgentId,
      goal: planRequests.goal,
      steps_json: planRequests.stepsJson,
      budget_wei: planRequests.budgetWei,
      source: planRequests.source,
      attempts: planRequests.attempts,
      verification_tier: planRequests.verificationTier,
      substitutions_json: planRequests.substitutionsJson,
      created_at: planRequests.createdAt,
    })
    .from(planRequests)
    .where(eq(planRequests.planId, planId))
    .limit(1);
  return row ?? null;
}

// ── Relay jobs ────────────────────────────────────────────────────────────────

export async function enqueueRelayJob(input: {
  taskId: string;
  stepIdx: number;
  configId: string;
  reqId: string;
  payload: string;
  registrant: string;
  endpointHash: string;
}): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .insert(relayJobs)
    .values({
      taskId: input.taskId,
      stepIdx: input.stepIdx,
      configId: input.configId,
      reqId: input.reqId,
      payload: input.payload,
      registrant: input.registrant,
      endpointHash: input.endpointHash,
      attempts: 0,
      nextRetryAt: now,
      status: "pending",
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return (result.rowsAffected ?? 0) > 0;
}

export async function listDueRelayJobs(
  nowSeconds: number,
  limit = 20,
): Promise<
  {
    task_id: string;
    step_idx: number;
    config_id: string;
    req_id: string;
    payload: string;
    registrant: string;
    endpoint_hash: string;
    attempts: number;
  }[]
> {
  return db
    .select({
      task_id: relayJobs.taskId,
      step_idx: relayJobs.stepIdx,
      config_id: relayJobs.configId,
      req_id: relayJobs.reqId,
      payload: relayJobs.payload,
      registrant: relayJobs.registrant,
      endpoint_hash: relayJobs.endpointHash,
      attempts: relayJobs.attempts,
    })
    .from(relayJobs)
    .where(
      and(
        inArray(relayJobs.status, ["pending", "retry"]),
        sql`${relayJobs.nextRetryAt} <= ${nowSeconds}`,
      ),
    )
    .orderBy(relayJobs.nextRetryAt)
    .limit(limit);
}

export async function markRelayJobRetry(
  taskId: string,
  stepIdx: number,
  attempts: number,
  nextRetryAt: number,
  lastError: string,
): Promise<void> {
  await db
    .update(relayJobs)
    .set({
      attempts,
      nextRetryAt,
      status: attempts >= 3 ? "failed" : "retry",
      lastError,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(and(eq(relayJobs.taskId, taskId), eq(relayJobs.stepIdx, stepIdx)));
}

export async function completeRelayJob(
  taskId: string,
  stepIdx: number,
): Promise<void> {
  await db
    .delete(relayJobs)
    .where(and(eq(relayJobs.taskId, taskId), eq(relayJobs.stepIdx, stepIdx)));
}

export async function getRelayJob(
  taskId: string,
  stepIdx: number,
): Promise<{
  status: string;
  attempts: number;
  last_error: string | null;
} | null> {
  const [row] = await db
    .select({
      status: relayJobs.status,
      attempts: relayJobs.attempts,
      last_error: relayJobs.lastError,
    })
    .from(relayJobs)
    .where(and(eq(relayJobs.taskId, taskId), eq(relayJobs.stepIdx, stepIdx)))
    .limit(1);
  return row ?? null;
}

// ── Trustless metadata ───────────────────────────────────────────────────────

export async function upsertTrustlessTask(input: {
  taskId: string;
  goal: string;
  intentHash: string;
  iterations: number;
  maxIterations: number;
  awaiting: number;
  janiceRequestId: string | null;
  lastResumeReason?: string | null;
}): Promise<void> {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(trustlessTasks)
    .values({
      ...input,
      lastResumeReason: input.lastResumeReason ?? null,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: trustlessTasks.taskId,
      set: {
        goal: sql`excluded.goal`,
        intentHash: sql`excluded.intent_hash`,
        iterations: sql`excluded.iterations`,
        maxIterations: sql`excluded.max_iterations`,
        awaiting: sql`excluded.awaiting`,
        janiceRequestId: sql`COALESCE(excluded.janice_request_id, janice_request_id)`,
        lastResumeReason: sql`COALESCE(excluded.last_resume_reason, last_resume_reason)`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function patchTrustlessTask(
  taskId: string,
  patch: {
    iterations?: number;
    maxIterations?: number;
    awaiting?: number;
    janiceRequestId?: string | null;
    lastResumeReason?: string | null;
  },
): Promise<void> {
  const next: Record<string, unknown> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (patch.iterations != null) next.iterations = patch.iterations;
  if (patch.maxIterations != null) next.maxIterations = patch.maxIterations;
  if (patch.awaiting != null) next.awaiting = patch.awaiting;
  if (patch.janiceRequestId !== undefined) next.janiceRequestId = patch.janiceRequestId;
  if (patch.lastResumeReason !== undefined) next.lastResumeReason = patch.lastResumeReason;
  await db.update(trustlessTasks).set(next).where(eq(trustlessTasks.taskId, taskId));
}

export async function getTrustlessTask(taskId: string): Promise<{
  task_id: string;
  goal: string;
  intent_hash: string;
  iterations: number;
  max_iterations: number;
  awaiting: number;
  janice_request_id: string | null;
  last_resume_reason: string | null;
} | null> {
  const [row] = await db
    .select({
      task_id: trustlessTasks.taskId,
      goal: trustlessTasks.goal,
      intent_hash: trustlessTasks.intentHash,
      iterations: trustlessTasks.iterations,
      max_iterations: trustlessTasks.maxIterations,
      awaiting: trustlessTasks.awaiting,
      janice_request_id: trustlessTasks.janiceRequestId,
      last_resume_reason: trustlessTasks.lastResumeReason,
    })
    .from(trustlessTasks)
    .where(eq(trustlessTasks.taskId, taskId))
    .limit(1);
  return row ?? null;
}

export async function listTrustlessTasksAwaitingJanice(): Promise<
  Array<{
    task_id: string;
    goal: string;
    iterations: number;
    max_iterations: number;
    awaiting: number;
    janice_request_id: string | null;
    last_resume_reason: string | null;
    updated_at: number;
  }>
> {
  return db
    .select({
      task_id: trustlessTasks.taskId,
      goal: trustlessTasks.goal,
      iterations: trustlessTasks.iterations,
      max_iterations: trustlessTasks.maxIterations,
      awaiting: trustlessTasks.awaiting,
      janice_request_id: trustlessTasks.janiceRequestId,
      last_resume_reason: trustlessTasks.lastResumeReason,
      updated_at: trustlessTasks.updatedAt,
    })
    .from(trustlessTasks)
    .where(eq(trustlessTasks.awaiting, TrustlessAwaiting.Janice));
}

export async function listTrustlessTasksAwaitingResume(): Promise<
  Array<{
    task_id: string;
    goal: string;
    iterations: number;
    max_iterations: number;
    awaiting: number;
    last_resume_reason: string | null;
  }>
> {
  return db
    .select({
      task_id: trustlessTasks.taskId,
      goal: trustlessTasks.goal,
      iterations: trustlessTasks.iterations,
      max_iterations: trustlessTasks.maxIterations,
      awaiting: trustlessTasks.awaiting,
      last_resume_reason: trustlessTasks.lastResumeReason,
    })
    .from(trustlessTasks)
    .where(eq(trustlessTasks.awaiting, TrustlessAwaiting.Resume));
}

export async function upsertTrustlessTurn(input: {
  taskId: string;
  iteration: number;
  requestId: string;
  finishReason: string;
  assistantMessage: string;
  toolCallsJson: string;
  rawResultHex: string | null;
  transcriptHash: string | null;
}): Promise<void> {
  await db
    .insert(trustlessTurns)
    .values({
      ...input,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoUpdate({
      target: [trustlessTurns.taskId, trustlessTurns.iteration],
      set: {
        requestId: sql`excluded.request_id`,
        finishReason: sql`excluded.finish_reason`,
        assistantMessage: sql`excluded.assistant_message`,
        toolCallsJson: sql`excluded.tool_calls_json`,
        rawResultHex: sql`excluded.raw_result_hex`,
        transcriptHash: sql`excluded.transcript_hash`,
      },
    });
}

export async function listTrustlessTurns(taskId: string): Promise<
  Array<{
    iteration: number;
    request_id: string;
    finish_reason: string;
    assistant_message: string;
    tool_calls_json: string;
    raw_result_hex: string | null;
    transcript_hash: string | null;
  }>
> {
  return db
    .select({
      iteration: trustlessTurns.iteration,
      request_id: trustlessTurns.requestId,
      finish_reason: trustlessTurns.finishReason,
      assistant_message: trustlessTurns.assistantMessage,
      tool_calls_json: trustlessTurns.toolCallsJson,
      raw_result_hex: trustlessTurns.rawResultHex,
      transcript_hash: trustlessTurns.transcriptHash,
    })
    .from(trustlessTurns)
    .where(eq(trustlessTurns.taskId, taskId))
    .orderBy(trustlessTurns.iteration);
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
