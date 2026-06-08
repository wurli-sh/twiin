import { describe, it, expect } from "vitest";
import { decodeFunctionData, encodeAbiParameters } from "viem";
import { NativeConfigId } from "../constants";
import {
  JsonApiAgentAbi,
  ParseWebsiteAgentAbi,
  LlmInferenceAgentAbi,
  encodeNativeAgentPayload,
  decodeNativeAgentResult,
  decodeStepResult,
  buildPriorStepContext,
  stepOutputLabelFromResult,
  enrichExternalPayload,
  decodeTaskCompletionFromLogData,
  validateOraclePlannerPayload,
  validateExternalAgentPayload,
} from "../somnia-agents";

describe("encodeNativeAgentPayload", () => {
  it("encodes somnia-oracle as fetchString by default", () => {
    const calldata = encodeNativeAgentPayload(
      NativeConfigId.ORACLE,
      '{"url":"https://api.example.com/x","selector":"data.label"}',
    );
    const decoded = decodeFunctionData({ abi: JsonApiAgentAbi, data: calldata });
    expect(decoded.functionName).toBe("fetchString");
    expect(decoded.args).toEqual([
      "https://api.example.com/x",
      "data.label",
    ]);
  });

  it("encodes somnia-oracle as fetchUint when decimals is set", () => {
    const calldata = encodeNativeAgentPayload(
      NativeConfigId.ORACLE,
      '{"url":"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd","selector":"bitcoin.usd","decimals":8}',
    );
    const decoded = decodeFunctionData({ abi: JsonApiAgentAbi, data: calldata });
    expect(decoded.functionName).toBe("fetchUint");
    expect(decoded.args?.[2]).toBe(8);
  });

  it("encodes web-intel as ExtractANumber when output is number", () => {
    const calldata = encodeNativeAgentPayload(
      NativeConfigId.WEB_INTEL,
      '{"url":"https://shop.example/item","prompt":"unit price in USD","output":"number"}',
    );
    const decoded = decodeFunctionData({ abi: ParseWebsiteAgentAbi, data: calldata });
    expect(decoded.functionName).toBe("ExtractANumber");
  });

  it("rejects fragile coingecko search oracle plans", () => {
    expect(() =>
      encodeNativeAgentPayload(
        NativeConfigId.ORACLE,
        '{"url":"https://api.coingecko.com/api/v3/search?query=dreamdex","selector":"coins.0.id"}',
      ),
    ).toThrow(/search\/discovery/i);
  });

  it("rejects coingecko simple/price with object-level selector", () => {
    expect(() =>
      encodeNativeAgentPayload(
        NativeConfigId.ORACLE,
        '{"url":"https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd","selector":"somnia"}',
      ),
    ).toThrow(/leaf selector/i);
  });

  it("encodes negative 24h change as fetchString (not fetchUint)", () => {
    const calldata = encodeNativeAgentPayload(
      NativeConfigId.ORACLE,
      `{"url":"${"https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd&include_24hr_change=true"}","selector":"somnia.usd_24h_change"}`,
    );
    const decoded = decodeFunctionData({ abi: JsonApiAgentAbi, data: calldata });
    expect(decoded.functionName).toBe("fetchString");
    expect(decoded.args?.[1]).toBe("somnia.usd_24h_change");
  });

  it("validateOraclePlannerPayload flags array-index selectors", () => {
    expect(() =>
      validateOraclePlannerPayload(
        "https://api.example.com/data",
        "coins.0.id",
      ),
    ).toThrow(/array-index/i);
  });

  it("encodes analysis-bot inferNumber from JSON payload", () => {
    const calldata = encodeNativeAgentPayload(
      NativeConfigId.ANALYSIS,
      '{"prompt":"Rate sentiment 1-10","minValue":1,"maxValue":10}',
    );
    const decoded = decodeFunctionData({ abi: LlmInferenceAgentAbi, data: calldata });
    expect(decoded.functionName).toBe("inferNumber");
  });
});

describe("decodeNativeAgentResult", () => {
  it("decodes ABI-encoded string results", () => {
    const hex = encodeAbiParameters([{ type: "string" }], ["hello"]);
    expect(decodeNativeAgentResult(hex)).toBe("hello");
  });

  it("decodes ABI-encoded uint256 results", () => {
    const hex = encodeAbiParameters([{ type: "uint256" }], [42n]);
    expect(decodeNativeAgentResult(hex)).toBe("42");
  });

  it("returns null for invalid bytes", () => {
    expect(decodeNativeAgentResult("0x01")).toBeNull();
  });

  it("decodes TaskCompleted log data (uint256 oracle price)", () => {
    const logData =
      "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000c512c8";
    expect(decodeTaskCompletionFromLogData(logData)).toBe("12915400");
  });

  it("decodes TaskCompleted log data when the event carries plain UTF-8 text", () => {
    const logData = encodeAbiParameters(
      [{ type: "string" }],
      ["I cannot fetch real-time data."],
    );
    expect(decodeTaskCompletionFromLogData(logData)).toBe(
      "I cannot fetch real-time data.",
    );
  });

  it("returns null when TaskCompleted log data is truncated", () => {
    const logData =
      "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020";
    expect(decodeTaskCompletionFromLogData(logData)).toBeNull();
  });
});

describe("decodeStepResult", () => {
  it("decodes raw UTF-8 external results", () => {
    const json = '{"sentiment":"bullish","score":82}';
    const hex = `0x${Buffer.from(json, "utf8").toString("hex")}` as const;
    expect(decodeStepResult(hex)).toBe(json);
  });

  it("prefers native ABI decode over UTF-8 fallback", () => {
    const hex = encodeAbiParameters([{ type: "string" }], ["hello"]);
    expect(decodeStepResult(hex)).toBe("hello");
  });
});

describe("buildPriorStepContext", () => {
  it("mirrors on-chain prior context formatting", () => {
    const json = '{"sentiment":"bullish"}';
    const hex = `0x${Buffer.from(json, "utf8").toString("hex")}` as const;
    const context = buildPriorStepContext(
      [{ stepIdx: 0, configId: 6, resultHex: hex }],
      1,
    );
    expect(context).toContain("Previous step outputs:");
    expect(context).toContain("external-6");
    expect(context).toContain('"sentiment":"bullish"');
  });

  it("uses agent name from JSON result instead of external-N", () => {
    const json = JSON.stringify({
      type: "docs-lens",
      agentName: "docs-lens@twiin",
      summary: "ok",
    });
    const hex = `0x${Buffer.from(json, "utf8").toString("hex")}` as const;
    const context = buildPriorStepContext(
      [{ stepIdx: 0, configId: 8, resultHex: hex }],
      1,
    );
    expect(context).toContain("- docs-lens:");
    expect(context).not.toContain("external-8");
  });
});

describe("stepOutputLabelFromResult", () => {
  it("prefers agentName from decoded JSON", () => {
    const label = stepOutputLabelFromResult(
      10,
      JSON.stringify({ type: "reactivity-lens", agentName: "reactivity-lens@twiin" }),
    );
    expect(label).toBe("reactivity-lens");
  });
});

describe("enrichExternalPayload", () => {
  it("appends prior context to plain-text payloads", () => {
    const payload = enrichExternalPayload(
      "0x696e737472756374696f6e" as `0x${string}`,
      "Previous step outputs:\n- external-6: ok",
    );
    const decoded = Buffer.from(payload.slice(2), "hex").toString("utf8");
    expect(decoded).toContain("instruction");
    expect(decoded).toContain("Previous step outputs:");
  });
});

describe("validateExternalAgentPayload", () => {
  it("accepts docs-lens JSON payload", () => {
    expect(() =>
      validateExternalAgentPayload(
        "docs-lens",
        '{"question":"How do agent gas fees work?","docPath":"agents"}',
      ),
    ).not.toThrow();
  });

  it("accepts plain-text docs-lens payload", () => {
    expect(() =>
      validateExternalAgentPayload("docs-lens", "plain text"),
    ).not.toThrow();
  });

  it("rejects invalid dreamdex action", () => {
    expect(() =>
      validateExternalAgentPayload(
        "dreamdex-mcp",
        '{"action":"bad","pair":"SOMI/USDC"}',
      ),
    ).toThrow(/action/i);
  });

  it("accepts dreamdex coingecko payload", () => {
    expect(() =>
      validateExternalAgentPayload(
        "dreamdex-mcp",
        '{"action":"coingecko","id":"somnia"}',
      ),
    ).not.toThrow();
  });

  it("accepts briefsmith plain-text payload", () => {
    expect(() =>
      validateExternalAgentPayload(
        "briefsmith",
        "Format an executive brief from prior outputs",
      ),
    ).not.toThrow();
  });
});
