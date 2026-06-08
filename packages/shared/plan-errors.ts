export const PlanErrorCode = {
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  NO_CAPABLE_AGENT: "NO_CAPABLE_AGENT",
  PLANNER_UNAVAILABLE: "PLANNER_UNAVAILABLE",
  INVALID_REQUEST: "INVALID_REQUEST",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type PlanErrorCodeValue =
  (typeof PlanErrorCode)[keyof typeof PlanErrorCode];

export type PlanErrorBody = {
  error: string;
  code: PlanErrorCodeValue;
  estimatedCostWei?: string;
  budgetWei?: string;
  requiredStepCount?: number;
  missingCapabilities?: string[];
  suggestedBudgetWei?: string;
  retryAfterSeconds?: number;
  agentName?: string;
  unhealthyConfigId?: number;
};

export class PlanError extends Error {
  code: PlanErrorCodeValue;
  status: number;
  body: PlanErrorBody;

  constructor(
    code: PlanErrorCodeValue,
    message: string,
    status: number,
    extras: Omit<PlanErrorBody, "error" | "code"> = {},
  ) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.status = status;
    this.body = { error: message, code, ...extras };
  }
}
