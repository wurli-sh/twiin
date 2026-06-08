import { MAX_CONSOLE_TEMPLATE_STEPS } from "@twiin/shared";
import { z } from "zod";

const StepSpecSchema = z.object({
  configId: z.number().int().min(0).max(100),
  payload: z.string().min(1).max(4000),
  maxCostWei: z.union([z.string().min(1), z.number(), z.null()]).optional(),
  timeoutSeconds: z.number().int().min(60).max(600),
});

const StepsOutputSchema = z
  .array(StepSpecSchema)
  .min(1)
  .max(MAX_CONSOLE_TEMPLATE_STEPS);

export type PlannerStepSpec = z.infer<typeof StepSpecSchema>;

export function parsePlannerStepsFromToolInput(input: unknown): PlannerStepSpec[] {
  if (Array.isArray(input)) {
    return StepsOutputSchema.parse(input);
  }
  if (input && typeof input === "object" && "steps" in input) {
    return StepsOutputSchema.parse((input as { steps: unknown }).steps);
  }
  throw new SyntaxError("planner tool input missing steps array");
}

/** Strip markdown fences and trailing prose; parse the first top-level JSON array. */
export function parsePlannerStepsJson(raw: string): PlannerStepSpec[] {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf("[");
  if (start === -1) {
    throw new SyntaxError("planner output missing JSON array");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        return StepsOutputSchema.parse(JSON.parse(slice));
      }
    }
  }

  throw new SyntaxError("planner output has unclosed JSON array");
}
