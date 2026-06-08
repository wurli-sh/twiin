import { describe, expect, it } from "vitest";
import addressesRaw from "../addresses.json";
import somniaManifestRaw from "../deployments/somniaTestnet.json";
import {
  CapabilityId,
  CHAIN_ID,
  NativeConfigId,
  loadAddresses,
  loadDeploymentManifest,
} from "../index";

describe("deployment manifests", () => {
  it("keeps addresses.json in sync with the Somnia deployment manifest", () => {
    const addresses = loadAddresses(addressesRaw);
    const manifest = loadDeploymentManifest(somniaManifestRaw);

    expect(addresses).toMatchObject(loadAddresses(manifest.addresses));
    expect(Number(addresses.chainId)).toBe(CHAIN_ID);
  });

  it("keeps native config ids aligned with the Somnia manifest", () => {
    const manifest = loadDeploymentManifest(somniaManifestRaw);
    const ids = manifest.nativeAgents.map((agent) => agent.configId);

    expect(ids).toEqual([
      NativeConfigId.JANICE,
      NativeConfigId.WEB_INTEL,
      NativeConfigId.ORACLE,
      NativeConfigId.ANALYSIS,
      NativeConfigId.REPORTER,
      NativeConfigId.EXECUTOR,
    ]);
  });

  it("keeps capability ids aligned with the Somnia manifest", () => {
    const manifest = loadDeploymentManifest(somniaManifestRaw);
    const byName = new Map(
      manifest.capabilities.map((cap) => [cap.name, cap.id] as const),
    );

    expect(byName.get("web.scrape")).toBe(CapabilityId.WEB_SCRAPE);
    expect(byName.get("web.scrape.discord")).toBe(
      CapabilityId.WEB_SCRAPE_DISCORD,
    );
    expect(byName.get("json.fetch")).toBe(CapabilityId.JSON_FETCH);
    expect(byName.get("llm.analyze")).toBe(CapabilityId.LLM_ANALYZE);
    expect(byName.get("llm.report")).toBe(CapabilityId.LLM_REPORT);
    expect(byName.get("data.specialized")).toBe(CapabilityId.DATA_SPECIALIZED);
    expect(byName.get("oracle.publish")).toBe(CapabilityId.ORACLE_PUBLISH);
    expect(byName.get("onchain.execute")).toBe(CapabilityId.ONCHAIN_EXECUTE);
  });
});
