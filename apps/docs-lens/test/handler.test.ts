import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDocsSummary,
  buildDocsUrl,
  executeDocsLens,
  isPageNotFound,
  isQuestionAnswered,
  normalizeDocPath,
  parseDocsPayload,
  resolveEffectiveDocPath,
} from "../src/handler";
import type { DocsLensEnv } from "../src/env";

const baseEnv: DocsLensEnv = {
  EXTERNAL_PRIVATE_KEY:
    "0x59c6995e998f97a5a0044966f0945382dbb5b2d0d7e54d99f7f9a0b7f8d6d7f0",
  SOMNIA_RPC_URL: "https://dream-rpc.somnia.network/",
  HOST: "127.0.0.1",
  PORT: 3011,
  EXTERNAL_PUBLIC_URL: "http://127.0.0.1:3011",
  AGENT_NAME: "docs-lens@twiin",
  AGENT_COST_STT: "0.15",
  REGISTRATION_DEPOSIT_STT: "5",
  AGENT_COST_WEI: 150000000000000000n,
  REGISTRATION_DEPOSIT_WEI: 5000000000000000000n,
};

function payloadHex(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("hex");
}

function mockResponse(ok: boolean, status: number, text: string) {
  return {
    ok,
    status,
    text: async () => text,
  };
}

function mockFetchSequence(
  handlers: Array<(url: string) => Promise<ReturnType<typeof mockResponse>>>,
) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const handler = handlers[call] ?? handlers[handlers.length - 1]!;
      call += 1;
      return handler(url);
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docs lens helpers", () => {
  it("normalizes doc paths", () => {
    expect(normalizeDocPath("readme")).toBe("readme");
    expect(normalizeDocPath("/developer/building-dapps.md")).toBe(
      "developer/building-dapps",
    );
    expect(normalizeDocPath(undefined)).toBe("readme");
  });

  it("builds docs ask URLs", () => {
    const url = buildDocsUrl(
      "https://docs.somnia.network",
      "readme",
      "How do agent gas fees work?",
    );
    expect(url).toBe(
      "https://docs.somnia.network/readme.md?ask=How%20do%20agent%20gas%20fees%20work%3F",
    );
  });

  it("detects page-not-found stubs", () => {
    expect(isPageNotFound("# Page Not Found\nThe URL `defi` does not exist.")).toBe(
      true,
    );
    expect(isPageNotFound("# Somnia Docs\n## Documentation")).toBe(false);
  });

  it("builds summary bullets from excerpt and question", () => {
    const summary = buildDocsSummary(
      "# Agents\n\nSomnia exposes JSON API agents and oracles for developers.",
      "What agents and oracles does Somnia expose?",
    );
    expect(summary).toContain("Agents");
    expect(summary).toContain("oracles");
  });

  it("detects when excerpt answers the question", () => {
    expect(
      isQuestionAnswered(
        "Developers can use agents, oracles, and dev tools on Somnia.",
        "What agents, oracles, and dev tools does Somnia expose?",
      ),
    ).toBe(true);
  });

  it("parses planner payload with defaults", () => {
    expect(parseDocsPayload({ question: "What oracles exist?" })).toEqual({
      question: "What oracles exist?",
      docPath: undefined,
    });
    expect(parseDocsPayload(null).question).toContain("agents and oracles");
  });

  it("resolves known-bad doc paths to readme without fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(
      resolveEffectiveDocPath("https://docs.somnia.network", "defi", fetchImpl),
    ).resolves.toBe("readme");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("executeDocsLens", () => {
  it("returns structured docs response on success", async () => {
    mockFetchSequence([
      async (url) => {
        if (!url.includes("ask=")) {
          return mockResponse(true, 200, "# Somnia Docs\n\nDocumentation index.");
        }
        return mockResponse(
          true,
          200,
          "# Agents\n\nGas fees are split into reserve and reward pots.",
        );
      },
    ]);

    const result = await executeDocsLens({
      taskId: "1",
      stepIdx: 0,
      payloadHex: payloadHex({
        question: "How do agent gas fees work?",
        docPath: "readme",
      }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      type: "docs-lens",
      agentName: "docs-lens@twiin",
      source: "somnia-docs",
      question: "How do agent gas fees work?",
      docPath: "readme",
      ok: true,
      status: 200,
    });
    expect(parsed.excerpt).toContain("Gas fees");
    expect(parsed.summary).toContain("Gas fees");
    expect(parsed.answered).toBe(true);
    expect(parsed.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to readme when primary docPath is known-bad", async () => {
    mockFetchSequence([
      async (url) => {
        expect(url).toContain("readme.md?ask=");
        return mockResponse(
          true,
          200,
          "# LP risks\n\nLiquidity providers face impermanent loss and slippage on AMM pools.",
        );
      },
    ]);

    const result = await executeDocsLens({
      taskId: "3",
      stepIdx: 1,
      payloadHex: payloadHex({
        question: "What are LP risks on dreamDEX?",
        docPath: "defi",
      }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("docs-lens");
    expect(parsed.docPath).toBe("readme");
    expect(parsed.fallbackUsed).toBe(true);
    expect(parsed.ok).toBe(true);
    expect(parsed.excerpt).toContain("LP risks");
  });

  it("falls back to readme when primary ask times out", async () => {
    mockFetchSequence([
      async (url) => {
        if (url.includes("developer/building-dapps.md") && !url.includes("ask=")) {
          return mockResponse(true, 200, "# Building DApps\n\nDeveloper guide.");
        }
        if (url.includes("developer/building-dapps.md?ask=")) {
          throw new Error("TimeoutError: The operation was aborted due to timeout");
        }
        if (url.includes("readme.md?ask=")) {
          return mockResponse(
            true,
            200,
            "# dreamDEX LP risks\n\nProviders face slippage and withdrawal constraints.",
          );
        }
        throw new Error(`unexpected url: ${url}`);
      },
    ]);

    const result = await executeDocsLens({
      taskId: "4",
      stepIdx: 0,
      payloadHex: payloadHex({
        question: "What are LP risks on dreamDEX?",
        docPath: "developer/building-dapps",
      }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("docs-lens");
    expect(parsed.docPath).toBe("readme");
    expect(parsed.fallbackUsed).toBe(true);
    expect(parsed.ok).toBe(true);
  });

  it("returns structured error when all fetch attempts fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const result = await executeDocsLens({
      taskId: "2",
      stepIdx: 0,
      payloadHex: payloadHex({ question: "test", docPath: "readme" }),
      env: baseEnv,
    });

    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("external-error");
    expect(parsed.partial.question).toBe("test");
  });
});
