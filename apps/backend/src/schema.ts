import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const keeperCursors = sqliteTable("keeper_cursors", {
  name: text("name").primaryKey(),
  block: integer("block").notNull().default(0),
});

export const tasks = sqliteTable("tasks", {
  taskId: text("task_id").primaryKey(),
  personalAgentId: text("personal_agent_id").notNull(),
  mode: integer("mode").notNull().default(0),
  budgetWei: text("budget_wei").notNull(),
  state: integer("state").notNull().default(0),
  cursor: integer("cursor").notNull().default(0),
  deadline: integer("deadline").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const steps = sqliteTable(
  "steps",
  {
    taskId: text("task_id").notNull(),
    stepIdx: integer("step_idx").notNull(),
    configId: text("config_id").notNull(),
    timeoutSeconds: integer("timeout_seconds"),
    state: integer("state").notNull().default(0),
    payload: text("payload").notNull().default(""),
    reqId: text("req_id"),
    resultHex: text("result_hex"),
    score: integer("score"),
    deadline: integer("deadline"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.stepIdx] })],
);

export const submittedResults = sqliteTable(
  "submitted_results",
  {
    taskId: text("task_id").notNull(),
    stepIdx: integer("step_idx").notNull(),
    resultHex: text("result_hex").notNull(),
    sig: text("sig").notNull(),
    submittedAt: integer("submitted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.stepIdx] })],
);

export const submittedRatings = sqliteTable(
  "submitted_ratings",
  {
    taskId: text("task_id").notNull(),
    stepIdx: integer("step_idx").notNull(),
    score: integer("score").notNull(),
    submittedAt: integer("submitted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.stepIdx] })],
);

export const externalAgents = sqliteTable("external_agents", {
  configId: text("config_id").primaryKey(),
  registrant: text("registrant").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  endpointHash: text("endpoint_hash").notNull(),
  capabilitiesJson: text("capabilities_json").notNull().default("[]"),
  isActive: integer("is_active").notNull().default(1),
  isVerified: integer("is_verified").notNull().default(0),
  lastVerifiedAt: integer("last_verified_at"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});

export const planRequests = sqliteTable("plan_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personalAgentId: text("personal_agent_id").notNull(),
  goal: text("goal").notNull(),
  stepsJson: text("steps_json").notNull(),
  budgetWei: text("budget_wei").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const trustlessTasks = sqliteTable("trustless_tasks", {
  taskId: text("task_id").primaryKey(),
  goal: text("goal").notNull(),
  intentHash: text("intent_hash").notNull(),
  iterations: integer("iterations").notNull().default(0),
  maxIterations: integer("max_iterations").notNull().default(0),
  awaiting: integer("awaiting").notNull().default(0),
  janiceRequestId: text("janice_request_id"),
  lastResumeReason: text("last_resume_reason"),
  updatedAt: integer("updated_at").notNull(),
});

export const trustlessTurns = sqliteTable(
  "trustless_turns",
  {
    taskId: text("task_id").notNull(),
    iteration: integer("iteration").notNull(),
    requestId: text("request_id").notNull(),
    finishReason: text("finish_reason").notNull(),
    assistantMessage: text("assistant_message").notNull().default(""),
    toolCallsJson: text("tool_calls_json").notNull().default("[]"),
    rawResultHex: text("raw_result_hex"),
    transcriptHash: text("transcript_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.iteration] })],
);
