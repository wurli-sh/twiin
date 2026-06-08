/** Decode a fixed-point uint256 oracle value (legacy fetchUint). */
export function formatScaledUsd(raw: string, decimals = 8): string | null {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return null;

  const normalized = digits.replace(/^0+(?=\d)/, "");
  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals);

  if (whole.replace(/^0+/, "").length > 15) return null;

  const wholeNumber = BigInt(whole);
  if (wholeNumber >= 1n) {
    const cents = fraction.slice(0, 2).replace(/0+$/, "");
    const formattedWhole = wholeNumber.toLocaleString();
    return cents ? `${formattedWhole}.${cents}` : formattedWhole;
  }

  const firstSignificant = fraction.search(/[1-9]/);
  if (firstSignificant === -1) return "0";
  const precision = Math.min(fraction.length, firstSignificant + 4);
  const trimmedFraction = fraction.slice(0, precision).replace(/0+$/, "");
  return trimmedFraction ? `0.${trimmedFraction}` : "0";
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function formatLargeUsd(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export type OracleUsdKind = "spot" | "large";

function formatOracleLargeUsd(raw: string, decimals = 8): string | null {
  const trimmed = raw.trim();
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? formatLargeUsd(n) : null;
  }
  if (!/^\d+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/^0+(?=\d)/, "");
  // Legacy fetchUint stores whole CoinGecko USD amounts multiplied by 10^decimals.
  if (digits.length > 10) {
    const unscaled = BigInt(trimmed) / BigInt(10 ** decimals);
    if (unscaled > 0n && unscaled < 10n ** 15n) {
      return formatLargeUsd(Number(unscaled));
    }
  }

  const n = Number(trimmed);
  return Number.isFinite(n) ? formatLargeUsd(n) : null;
}

function formatOracleSpotUsd(raw: string, decimals = 8): string | null {
  const trimmed = raw.trim();
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return trimTrailingZeros(n.toFixed(8));
  }
  if (!/^\d+$/.test(trimmed)) return null;

  const scaled = formatScaledUsd(trimmed, decimals);
  if (!scaled) return null;

  const asNum = Number(scaled.replace(/,/g, ""));
  if (asNum >= 1 && asNum < 2) {
    const corrected = formatScaledUsd((BigInt(trimmed) / 10n).toString(), decimals);
    if (corrected) {
      const correctedNum = Number(corrected.replace(/,/g, ""));
      if (correctedNum > 0 && correctedNum < 0.5) return corrected;
    }
  }

  return scaled;
}

/**
 * Format CoinGecko oracle output for display.
 * Prefer fetchString oracle steps (decimal strings). Legacy fetchUint uints
 * with 8-decimal decode are corrected when they look 10x too high (~$1.1x vs ~$0.11).
 */
export function formatOracleUsdValue(
  raw: string,
  opts?: { kind?: OracleUsdKind; decimals?: number },
): string | null {
  const decimals = opts?.decimals ?? 8;
  const kind = opts?.kind ?? "spot";
  return kind === "large"
    ? formatOracleLargeUsd(raw, decimals)
    : formatOracleSpotUsd(raw, decimals);
}

export function formatOracleChangePercent(raw: string): string {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export const ORACLE_METRIC_LABELS = [
  "Price",
  "24h change",
  "Market cap",
  "24h volume",
] as const;

/** Fix legacy reporter text that copied mis-scaled fetchUint prices (~$1.1x vs ~$0.11). */
export function fixMisscaledSomiPriceInReport(text: string): string {
  return text.replace(
    /(Price:\s*\$?)(\d+\.\d+)(\s*USD)/gi,
    (_match, prefix: string, num: string, suffix: string) => {
      const n = Number(num);
      if (!Number.isFinite(n) || n < 1 || n >= 2) {
        return `${prefix}${num}${suffix}`;
      }
      const fixed = trimTrailingZeros((n / 10).toFixed(8));
      return `${prefix}${fixed}${suffix}`;
    },
  );
}

/**
 * Replace reporter numeric lines with values derived from oracle step outputs.
 * Handles raw uints, comma-formatted integers, and mis-scaled legacy fetchUint.
 */
export function rewriteStatsSnapshotFromOracleValues(
  text: string,
  oracleValues: Array<{ label: string; formatted: string }>,
): string {
  if (oracleValues.length === 0) return fixMisscaledSomiPriceInReport(text);

  const aliasForLabel = (label: string): string[] => {
    switch (label.toLowerCase()) {
      case "price":
        return ["price"];
      case "24h change":
        return ["24h change", "change"];
      case "market cap":
        return ["market cap"];
      case "24h volume":
        return ["24h volume", "volume"];
      default:
        return [label];
    }
  };

  const lines = text.split("\n").map((line) => {
    for (const { label, formatted } of oracleValues) {
      for (const alias of aliasForLabel(label)) {
        const pattern = new RegExp(
          `^((?:-\\s*)?(?:\\*\\*)?${alias.replace(/\s+/g, "\\s+")}(?:\\*\\*)?\\s*:\\s*)(?:\\$)?[\\d,]+(?:\\.\\d+)?(?:\\s*(?:USD|%)?)?\\s*$`,
          "i",
        );
        if (pattern.test(line.trim())) {
          return line.replace(pattern, (_match, prefix: string) => `${prefix}${formatted}`);
        }
      }
    }
    return line;
  });

  return fixMisscaledSomiPriceInReport(lines.join("\n"));
}
