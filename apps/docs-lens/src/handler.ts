import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import type { DocsLensEnv } from "./env";

const DEFAULT_DOCS_BASE = "https://docs.somnia.network";
const EXCERPT_MAX_CHARS = 2000;
const ASK_TIMEOUT_MS = 45_000;
const PRECHECK_TIMEOUT_MS = 10_000;
const FALLBACK_ASK_PATH = "readme";
const SITEMAP_PATH = "sitemap";

export const KNOWN_BAD_DOC_PATHS = new Set(["defi", "agents"]);

const STOP_WORDS = new Set([
  "what",
  "does",
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "how",
  "are",
  "expose",
  "somnia",
]);

export function normalizeDocPath(docPath?: string): string {
  const raw = (docPath ?? FALLBACK_ASK_PATH).trim().replace(/^\/+|\/+$/g, "");
  return raw.replace(/\.md$/i, "");
}

export function buildDocsPageUrl(baseUrl: string, docPath: string): string {
  const path = normalizeDocPath(docPath);
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/${path}.md`;
}

export function buildDocsUrl(
  baseUrl: string,
  docPath: string | undefined,
  question: string,
): string {
  return `${buildDocsPageUrl(baseUrl, normalizeDocPath(docPath))}?ask=${encodeURIComponent(question)}`;
}

export function isPageNotFound(text: string): boolean {
  return /page not found/i.test(text) || /does not exist/i.test(text);
}

export function parseDocsPayload(json: Record<string, unknown> | null): {
  question: string;
  docPath?: string;
} {
  const question =
    typeof json?.question === "string" && json.question.trim()
      ? json.question.trim()
      : "What agents and oracles does Somnia expose?";
  const docPath = typeof json?.docPath === "string" ? json.docPath : undefined;
  return { question, docPath };
}

export function parseDocsPayloadWithRaw(
  raw: string,
  json: Record<string, unknown> | null,
): {
  question: string;
  docPath?: string;
} {
  if (!json && raw.trim()) {
    return { question: raw.trim() };
  }
  return parseDocsPayload(json);
}

export function extractQuestionKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

export function buildDocsSummary(excerpt: string, question: string): string {
  const keywords = extractQuestionKeywords(question);
  const lines = excerpt
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      bullets.push(line.replace(/^#+\s*/, ""));
      break;
    }
  }

  for (const line of lines) {
    const normalized = line.replace(/^[-*#\d.]+\s*/, "");
    if (keywords.some((keyword) => normalized.toLowerCase().includes(keyword))) {
      bullets.push(normalized.slice(0, 200));
    }
    if (bullets.length >= 5) break;
  }

  if (bullets.length === 0 && lines.length > 0) {
    bullets.push(lines[0]!.slice(0, 200));
  }

  return bullets.map((bullet) => `• ${bullet}`).join("\n");
}

export function isQuestionAnswered(excerpt: string, question: string): boolean {
  const keywords = extractQuestionKeywords(question);
  if (keywords.length === 0) return excerpt.length > 50;
  const lower = excerpt.toLowerCase();
  const hits = keywords.filter((keyword) => lower.includes(keyword)).length;
  return hits >= Math.min(2, keywords.length) || hits / keywords.length >= 0.4;
}

type FetchResult = {
  ok: boolean;
  status: number;
  text: string;
  url: string;
};

async function fetchDocs(url: string, timeoutMs: number): Promise<FetchResult> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, url };
}

export async function resolveEffectiveDocPath(
  baseUrl: string,
  docPath: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const normalized = normalizeDocPath(docPath);
  if (KNOWN_BAD_DOC_PATHS.has(normalized)) {
    return FALLBACK_ASK_PATH;
  }

  try {
    const pageUrl = buildDocsPageUrl(baseUrl, normalized);
    const res = await fetchImpl(pageUrl, { signal: AbortSignal.timeout(PRECHECK_TIMEOUT_MS) });
    const text = await res.text();
    if (isPageNotFound(text)) {
      return FALLBACK_ASK_PATH;
    }
  } catch {
    /* try primary ask anyway */
  }

  return normalized;
}

type DocsAttempt = {
  path: string;
  withAsk: boolean;
};

function buildAttemptChain(startPath: string): DocsAttempt[] {
  const attempts: DocsAttempt[] = [{ path: startPath, withAsk: true }];
  if (startPath !== FALLBACK_ASK_PATH) {
    attempts.push({ path: FALLBACK_ASK_PATH, withAsk: true });
  }
  attempts.push({ path: SITEMAP_PATH, withAsk: false });
  return attempts;
}

function buildDocsResponse(params: {
  env: DocsLensEnv;
  question: string;
  requestedPath: string;
  result: FetchResult;
  withAsk: boolean;
  fallbackUsed: boolean;
}): string {
  const { env, question, requestedPath, result, withAsk, fallbackUsed } = params;
  const excerpt = result.text.slice(0, EXCERPT_MAX_CHARS);
  const summary = buildDocsSummary(excerpt, question);
  const answered =
    result.ok && !isPageNotFound(excerpt) && isQuestionAnswered(excerpt, question);

  const findings = result.ok
    ? [
        `Official Somnia docs query: ${question}`,
        fallbackUsed
          ? `Used fallback path "${requestedPath}" after primary docs path failed`
          : `Retrieved ${result.text.length} chars from ${requestedPath}`,
        withAsk
          ? answered
            ? "Excerpt appears relevant to the question"
            : "Excerpt retrieved but may not fully answer the question"
          : "Included sitemap index as last-resort documentation context",
      ]
    : [
        `Official Somnia docs query: ${question}`,
        `Docs request to ${result.url} returned HTTP ${result.status}`,
        "No documentation content available for rating",
      ];

  return JSON.stringify({
    type: "docs-lens",
    agentName: env.AGENT_NAME,
    source: "somnia-docs",
    question,
    docPath: requestedPath,
    docUrl: result.url,
    status: result.status,
    ok: result.ok && !isPageNotFound(excerpt),
    answered,
    fallbackUsed,
    summary,
    excerpt,
    findings,
    ts: new Date().toISOString(),
  });
}

export async function executeDocsLens(input: ExternalExecuteInput): Promise<string> {
  const env = input.env as DocsLensEnv;
  const parsed = parsePayload(input.payloadHex);
  const baseUrl = env.DOCS_BASE_URL ?? DEFAULT_DOCS_BASE;
  const { question, docPath } = parseDocsPayloadWithRaw(
    parsed.raw,
    parsed.json as Record<string, unknown> | null,
  );
  const requestedPath = normalizeDocPath(docPath);

  try {
    const startPath = await resolveEffectiveDocPath(baseUrl, docPath);
    const attempts = buildAttemptChain(startPath);
    let lastError: unknown;

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      const url = attempt.withAsk
        ? buildDocsUrl(baseUrl, attempt.path, question)
        : buildDocsPageUrl(baseUrl, attempt.path);
      const timeoutMs = attempt.withAsk ? ASK_TIMEOUT_MS : PRECHECK_TIMEOUT_MS;

      try {
        const result = await fetchDocs(url, timeoutMs);
        if (!attempt.withAsk && isPageNotFound(result.text)) {
          continue;
        }
        const fallbackUsed = i > 0 || startPath !== requestedPath;
        return buildDocsResponse({
          env,
          question,
          requestedPath: attempt.path,
          result,
          withAsk: attempt.withAsk,
          fallbackUsed,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("all docs fetch attempts failed");
  } catch (error) {
    const docUrl = buildDocsUrl(baseUrl, docPath, question);
    return structuredError(env.AGENT_NAME, "somnia-docs", String(error), {
      question,
      docPath: requestedPath,
      docUrl,
      partial: true,
    });
  }
}
