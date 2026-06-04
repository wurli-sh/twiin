import { describe, it, expect } from "vitest";
import { decodeFunctionData, encodeAbiParameters } from "viem";
import { NativeConfigId } from "../constants";
import {
  JsonApiAgentAbi,
  ParseWebsiteAgentAbi,
  LlmInferenceAgentAbi,
  encodeNativeAgentPayload,
  decodeNativeAgentResult,
  validateOraclePlannerPayload,
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
});
