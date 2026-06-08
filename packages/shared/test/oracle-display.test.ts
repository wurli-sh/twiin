import { describe, expect, it } from "vitest";
import {
  formatOracleChangePercent,
  formatOracleUsdValue,
  formatScaledUsd,
  fixMisscaledSomiPriceInReport,
  rewriteStatsSnapshotFromOracleValues,
} from "../oracle-display";

describe("formatScaledUsd", () => {
  it("formats sub-dollar prices with 8 decimals", () => {
    expect(formatScaledUsd("11363400")).toBe("0.1136");
  });

  it("formats legacy mis-scaled uint as whole dollars", () => {
    expect(formatScaledUsd("113634000")).toBe("1.13");
  });
});

describe("formatOracleUsdValue", () => {
  it("formats fetchString decimal spot prices", () => {
    expect(formatOracleUsdValue("0.113634", { kind: "spot" })).toBe("0.113634");
  });

  it("corrects legacy fetchUint spot prices that are 10x high", () => {
    expect(formatOracleUsdValue("113605000", { kind: "spot" })).toBe("0.1136");
  });

  it("formats fetchString large USD amounts", () => {
    expect(formatOracleUsdValue("18191802", { kind: "large" })).toBe("18,191,802");
  });

  it("formats legacy fetchUint market cap scaled by 10^8", () => {
    expect(formatOracleUsdValue("1819180200000000", { kind: "large" })).toBe(
      "18,191,802",
    );
  });

  it("formats legacy fetchUint spot prices without treating them as whole dollars", () => {
    expect(formatOracleUsdValue("11369200", { kind: "spot" })).toBe("0.1136");
    expect(formatOracleUsdValue("113692000", { kind: "spot" })).toBe("0.1136");
  });

  it("formats percent-like strings unchanged via spot path", () => {
    expect(formatOracleUsdValue("3.061", { kind: "spot" })).toBe("3.061");
  });
});

describe("formatOracleChangePercent", () => {
  it("adds a plus sign for positive change", () => {
    expect(formatOracleChangePercent("3.975840454710508")).toBe("+3.98%");
  });
});

describe("rewriteStatsSnapshotFromOracleValues", () => {
  it("replaces bogus reporter integers with formatted oracle values", () => {
    const input = [
      "Price: 11,369,200",
      "24h Change: 3.975840454710508%",
      "Market Cap: 1,821,345,765,602,568",
      "24h Volume: 415,886,056,081,888",
    ].join("\n");
    const out = rewriteStatsSnapshotFromOracleValues(input, [
      { label: "Price", formatted: "$0.113692" },
      { label: "24h change", formatted: "+3.98%" },
      { label: "Market cap", formatted: "$18,191,802" },
      { label: "24h volume", formatted: "$4,158,861" },
    ]);
    expect(out).toContain("Price: $0.113692");
    expect(out).toContain("24h Change: +3.98%");
    expect(out).toContain("Market Cap: $18,191,802");
    expect(out).toContain("24h Volume: $4,158,861");
  });
});

describe("fixMisscaledSomiPriceInReport", () => {
  it("corrects legacy reporter prices around $1.1x to ~$0.11", () => {
    const input =
      "Price: 1.13605000 USD\n24h Change: +3.03%\nNote: single-source.";
    expect(fixMisscaledSomiPriceInReport(input)).toContain("Price: 0.113605 USD");
  });
});
