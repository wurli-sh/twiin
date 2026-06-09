import {
  parsePayload,
  structuredError,
  type ExternalExecuteInput,
} from "@twiin/external-kit";
import type { DocsLensEnv } from "./env";

const DEFAULT_DOCS_BASE = "https://docs.somnia.network";
const EXCERPT_MAX_CHARS = 10_000;
const ASK_TIMEOUT_MS = 45_000;
const PRECHECK_TIMEOUT_MS = 10_000;
const FALLBACK_ASK_PATH = "readme";
const SITEMAP_PATH = "sitemap";

const GITBOOK_TAG_RE = /\{%[^%]*%\}/g;
const GITBOOK_BLOCK_RE = /\{%\s*@mermaid[^%]*%\}[\s\S]*?\{\%\s*endmermaid\s*%\}/gi;
const GITBOOK_END_RE = /\{%\s*endhint\s*%\}/gi;

function stripGitBookTags(text: string): string {
  return text
    .replace(GITBOOK_BLOCK_RE, "")
    .replace(GITBOOK_TAG_RE, "")
    .replace(GITBOOK_END_RE, "")
    .replace(/^\s*[\r\n]/gm, "")
    .trim();
}

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
  const seen = new Set<string>();
  const MAX_BULLETS = 24;
  const MAX_SECTION_CHARS = 800;

  const isDiagramLine = (l: string) =>
    /^(flowchart|subgraph|end\b|-->|--->)/i.test(l) ||
    (l.includes("[") && l.includes("]") && !l.includes("**") && !l.startsWith("-") && !l.startsWith("*"));

  const conciseText = (text: string): string => {
    const normalized = text.replace(/^[-*#\d.]+\s*/, "").trim();
    if (!normalized) return "";
    if (normalized.length <= MAX_SECTION_CHARS) return normalized;
    const slice = normalized.slice(0, MAX_SECTION_CHARS);
    const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "));
    if (sentenceEnd > MAX_SECTION_CHARS * 0.5) {
      return `${slice.slice(0, sentenceEnd + 1).trimEnd()}…`;
    }
    const lastSpace = slice.lastIndexOf(" ");
    return `${(lastSpace > MAX_SECTION_CHARS * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
  };

  const pushBullet = (text: string) => {
    const normalized = conciseText(text);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bullets.push(normalized);
  };

  const collectSectionContent = (startIdx: number): string[] => {
    const content: string[] = [];
    for (let j = startIdx; j < lines.length; j++) {
      const candidate = lines[j]!;
      if (candidate.startsWith("#")) break;
      if (isDiagramLine(candidate)) continue;
      const normalized = candidate.replace(/^[-*#\d.]+\s*/, "").trim();
      if (!normalized) continue;
      if (/^[-*]\s+/.test(candidate) || /^\d+\.\s+/.test(candidate)) {
        pushBullet(normalized);
        continue;
      }
      content.push(normalized);
      if (content.length >= 3) break;
    }
    return content;
  };

  for (let i = 0; i < lines.length && bullets.length < MAX_BULLETS; i++) {
    const line = lines[i]!;

    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").trim();
      const contentLines = collectSectionContent(i + 1);
      if (contentLines.length > 0) {
        pushBullet(`${heading} — ${contentLines.join(" ")}`);
      } else if (!seen.has(heading.toLowerCase())) {
        seen.add(heading.toLowerCase());
        bullets.push(heading);
      }
      continue;
    }

    if (isDiagramLine(line)) continue;

    const normalized = line.replace(/^[-*#\d.]+\s*/, "");
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      pushBullet(normalized);
      continue;
    }

    if (keywords.some((keyword) => normalized.toLowerCase().includes(keyword))) {
      pushBullet(normalized);
    }
  }

  if (bullets.length === 0 && lines.length > 0) {
    for (const line of lines) {
      if (line.startsWith("#") || isDiagramLine(line)) continue;
      pushBullet(line);
      if (bullets.length >= 6) break;
    }
  }

  const MAX_SUMMARY_CHARS = 3_500;
  const selected: string[] = [];
  let used = 0;
  for (const bullet of bullets) {
    const entry = `• ${bullet}`;
    if (used + entry.length + 1 > MAX_SUMMARY_CHARS && selected.length > 0) break;
    selected.push(bullet);
    used += entry.length + 1;
  }

  return selected.map((bullet) => `• ${bullet}`).join("\n");
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
  const attempts: DocsAttempt[] = [{ path: startPath, withAsk: false }];
  if (startPath !== FALLBACK_ASK_PATH) {
    attempts.push({ path: FALLBACK_ASK_PATH, withAsk: false });
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
  const cleanText = stripGitBookTags(result.text);
  const excerpt = cleanText.slice(0, EXCERPT_MAX_CHARS);
  const summary = buildDocsSummary(excerpt, question);
  const answered =
    result.ok && !isPageNotFound(excerpt) && isQuestionAnswered(excerpt, question);

  const findings = result.ok
    ? [
        `Official Somnia docs query: ${question}`,
        fallbackUsed
          ? `Used fallback path "${requestedPath}" after primary docs path failed`
          : `Retrieved ${result.text.length} chars from ${requestedPath}`,
      answered
        ? "Extracted relevant sections from documentation matching the question"
        : "Documentation content retrieved but may not fully answer the question",
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
