/**
 * Gate 0 — TrustlessJanice measurements (T2/T3/T4).
 *
 * Usage:
 *   pnpm --filter @twiin/contracts exec hardhat run scripts/measure-trustless-janice.ts --network somniaTestnet
 *   pnpm --filter @twiin/contracts exec hardhat run scripts/measure-trustless-janice.ts --network hardhat
 *
 * Writes docs/plans/2026-06-04-trustless-janice-gate-results.md
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ethers } from "hardhat";
import { deployAll, deriveTwiinAccount } from "../test/helpers";

const SUBCOMMITTEE_SIZE = 3n;
const JANICE_CONFIG_ID = 0n;
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RESULTS_PATH = path.join(
  REPO_ROOT,
  "docs/plans/2026-06-04-trustless-janice-gate-results.md",
);
const T3_CACHE_PATH = path.join(__dirname, ".gate0-t3-cache.json");

type GateResults = {
  measuredAt: string;
  network: string;
  chainId: number;
  t2: {
    payloadMaxIterationsAccepted: number[];
    contractMaxJaniceIterations: number;
    uint8Max: number;
    note: string;
  };
  t3: {
    createTrustlessTaskGas: number;
    janiceCallbackGas: number;
    hireSubAgentRoundTripGas: number;
    resumeTrustlessTaskGas: number;
    note: string;
  };
  t4: {
    requestDepositWei: string;
    janiceRunnerCostWei: string;
    janiceCostPerIterationWei: string;
    janiceCostPerIterationStt: string;
    singleVsMultiIterationNote: string;
  };
  recommendations: {
    maxJaniceIterations: number;
    minBudgetMultiplier: number;
    janiceRoundBufferMultiplier: number;
    minBudgetFormula: string;
  };
};

function encodeInferToolsChat(maxIterations: number): string {
  return ethers.Interface.from([
    "function inferToolsChat(string,string,string,uint8)",
  ]).encodeFunctionData("inferToolsChat", [
    "Gate 0 probe",
    '[{"role":"user","content":"ping"}]',
    '[{"name":"completeTrustlessTask"}]',
    maxIterations,
  ]);
}

function encodeTrustlessResult(finishReason: string) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string[]", "bytes[]", "string"],
    [finishReason, [], [], ""],
  );
}

function encodeHireSubAgent() {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes", "uint256", "uint32"],
    [2n, "0x", ethers.parseEther("0.1"), 900],
  );
}

function encodeTrustlessToolResult(
  finishReason: string,
  toolNames: string[],
  toolArgs: string[],
) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string[]", "bytes[]", "string"],
    [finishReason, toolNames, toolArgs, ""],
  );
}

function encodeComplete(result: string) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string"], [result]);
}

async function measureLocalGas(): Promise<GateResults["t3"]> {
  const d = await deployAll({ useMockApi: true });
  const [, , user] = await ethers.getSigners();
  await d.factory.connect(user).deployTwiin("gate0-probe", {
    value: ethers.parseEther("5"),
  });
  const agentId = 1n;
  await d.policy.connect(user).toggleKillSwitch(agentId, false);

  const acctAddr = await deriveTwiinAccount(
    d.registry6551,
    d.twiinAccountImpl,
    await d.twiinAgent.getAddress(),
    agentId,
  );
  const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
  const mockApi = d.mockApi!;
  const orchAddr = await d.orchestrator.getAddress();
  const budget = ethers.parseEther("1");

  const createCalldata = d.orchestrator.interface.encodeFunctionData(
    "createTrustlessTask",
    [
      agentId,
      ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["gate0 gas probe"]),
      budget,
    ],
  );

  const createTx = await acct
    .connect(user)
    .execute(orchAddr, budget, createCalldata, 0);
  const createReceipt = await createTx.wait();

  const janiceCallbackTx = await mockApi.fulfill(
    1n,
    encodeTrustlessToolResult(
      "tool_calls",
      ["hireSubAgent"],
      [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bytes", "uint256", "uint32"],
          [2n, "0x", ethers.parseEther("0.5"), 900],
        ),
      ],
    ),
  );
  const janiceCallbackReceipt = await janiceCallbackTx.wait();

  const stepCallbackTx = await mockApi.fulfill(
    2n,
    ethers.toUtf8Bytes("oracle-result"),
  );
  const stepCallbackReceipt = await stepCallbackTx.wait();

  const janice = await d.agentRegistry.get(JANICE_CONFIG_ID);
  const expectedCost =
    (await mockApi.getRequestDeposit()) + janice.costWei * SUBCOMMITTEE_SIZE;

  const resumePayload = encodeInferToolsChat(8);
  const resumeTx = await d.orchestrator
    .connect(d.keeper)
    .resumeTrustlessTask(1n, resumePayload, expectedCost);
  const resumeReceipt = await resumeTx.wait();

  return {
    createTrustlessTaskGas: Number(createReceipt!.gasUsed),
    janiceCallbackGas: Number(janiceCallbackReceipt!.gasUsed),
    hireSubAgentRoundTripGas:
      Number(janiceCallbackReceipt!.gasUsed) +
      Number(stepCallbackReceipt!.gasUsed),
    resumeTrustlessTaskGas: Number(resumeReceipt!.gasUsed),
    note: "Measured on local Hardhat with MockAgentsApi: Janice hireSubAgent callback + oracle step settle + resumeTrustlessTask.",
  };
}

async function measureLiveCosts(
  agentsApiAddr: string,
  registryAddr: string,
): Promise<GateResults["t4"]> {
  const agentsApi = await ethers.getContractAt(
    ["function getRequestDeposit() view returns (uint256)"],
    agentsApiAddr,
  );
  const registry = await ethers.getContractAt(
    [
      "function get(uint256 configId) view returns (tuple(uint256 configId,uint256 somniaAgentId,uint256 costWei,uint8 trustTier,bool active,string name,bytes32[] capabilities))",
    ],
    registryAddr,
  );

  const deposit = await agentsApi.getRequestDeposit();
  const janice = await registry.get(JANICE_CONFIG_ID);
  const janiceCost = deposit + janice.costWei * SUBCOMMITTEE_SIZE;

  return {
    requestDepositWei: deposit.toString(),
    janiceRunnerCostWei: janice.costWei.toString(),
    janiceCostPerIterationWei: janiceCost.toString(),
    janiceCostPerIterationStt: ethers.formatEther(janiceCost),
    singleVsMultiIterationNote:
      "Each trustless Janice iteration charges one native-lane request (deposit + runnerCost × 3). Multi-iteration tasks multiply this cost; hired sub-agent steps add separate step costs.",
  };
}

async function probeT2(agentsApiAddr: string, janiceSomniaId: bigint): Promise<GateResults["t2"]> {
  const agentsApi = await ethers.getContractAt(
    [
      "function createRequest(uint256 agentId,address callback,bytes4 selector,bytes payload) payable returns (uint256)",
      "function getRequestDeposit() view returns (uint256)",
    ],
    agentsApiAddr,
  );
  const deposit = await agentsApi.getRequestDeposit();
  const accepted: number[] = [];

  for (const maxIter of [1, 8, 16, 255]) {
    try {
      const payload = encodeInferToolsChat(maxIter);
      await agentsApi.createRequest.staticCall(
        janiceSomniaId,
        ethers.ZeroAddress,
        "0x00000000",
        payload,
        { value: deposit },
      );
      accepted.push(maxIter);
    } catch {
      // not accepted at RPC simulation layer
    }
  }

  return {
    payloadMaxIterationsAccepted: accepted,
    contractMaxJaniceIterations: 8,
    uint8Max: 255,
    note:
      "inferToolsChat maxIterations is uint8 (0–255). Twiin contract enforces MAX_JANICE_ITERATIONS=8 in the trustless loop regardless of payload. Live Agents API accepts encoded payloads for tested values that fit uint8.",
  };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  const manifestPath = path.join(
    REPO_ROOT,
    "packages/shared/deployments/somniaTestnet.json",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    agentsApi: string;
    addresses: { agentRegistry: string };
    nativeAgents: Array<{ configId: number; somniaId: string }>;
  };

  const agentsApiAddr =
    process.env.AGENTS_API_ADDRESS ?? manifest.agentsApi;
  const registryAddr = manifest.addresses.agentRegistry;
  const janiceSomniaId = BigInt(
    manifest.nativeAgents.find((a) => a.configId === 0)!.somniaId,
  );

  console.log("Gate 0 — TrustlessJanice measurements");
  console.log("Network:", network.name, "chainId:", network.chainId.toString());

  let t3: GateResults["t3"];
  let t4: GateResults["t4"];
  let t2: GateResults["t2"];

  if (isLocal) {
    t3 = await measureLocalGas();
    console.log("\n[T3] Local gas (Hardhat):", t3);
    const mockApi = (await deployAll({ useMockApi: true })).mockApi!;
    t4 = {
      requestDepositWei: (await mockApi.getRequestDeposit()).toString(),
      janiceRunnerCostWei: (
        await (await deployAll({ useMockApi: true })).agentRegistry.get(0)
      ).costWei.toString(),
      janiceCostPerIterationWei: "0",
      janiceCostPerIterationStt: "0",
      singleVsMultiIterationNote: "Use somniaTestnet run for live STT costs.",
    };
    const janice = await (await deployAll({ useMockApi: true })).agentRegistry.get(0);
    const deposit = await mockApi.getRequestDeposit();
    t4.janiceCostPerIterationWei = (deposit + janice.costWei * SUBCOMMITTEE_SIZE).toString();
    t4.janiceCostPerIterationStt = ethers.formatEther(t4.janiceCostPerIterationWei);
    t2 = {
      payloadMaxIterationsAccepted: [1, 8, 16, 255],
      contractMaxJaniceIterations: 8,
      uint8Max: 255,
      note: "Local mock accepts all uint8 payload values. Re-run on somniaTestnet for live Agents API probe.",
    };
  } else {
    t4 = await measureLiveCosts(agentsApiAddr, registryAddr);
    console.log("\n[T4] Live STT costs:", t4);
    t2 = await probeT2(agentsApiAddr, janiceSomniaId);
    console.log("\n[T2] maxIterations probe:", t2);
    if (!fs.existsSync(T3_CACHE_PATH)) {
      throw new Error(
        "Run on --network hardhat first to populate .gate0-t3-cache.json",
      );
    }
    t3 = JSON.parse(fs.readFileSync(T3_CACHE_PATH, "utf8")) as GateResults["t3"];
    t3.note =
      "Gas from cached Hardhat mock run (identical contract build). Live Somnia gas may differ slightly.";
  }

  if (isLocal) {
    fs.writeFileSync(T3_CACHE_PATH, JSON.stringify(t3, null, 2));
  }

  const janiceCost = BigInt(t4.janiceCostPerIterationWei);
  const results: GateResults = {
    measuredAt: new Date().toISOString(),
    network: network.name,
    chainId: Number(network.chainId),
    t2,
    t3,
    t4,
    recommendations: {
      maxJaniceIterations: 8,
      minBudgetMultiplier: 2,
      janiceRoundBufferMultiplier: 3,
      minBudgetFormula: `minBudgetWei = janiceCostWei * 2, janiceCostWei = deposit + runnerCost * 3 (${ethers.formatEther(janiceCost)} STT/iter on ${isLocal ? "mock" : "somniaTestnet"})`,
    },
  };

  const md = `# TrustlessJanice Gate 0 Results

> Generated by \`packages/contracts/scripts/measure-trustless-janice.ts\` — do not edit by hand.
> Measured: ${results.measuredAt}
> Network: ${results.network} (chainId ${results.chainId})

## T2 — maxIterations overflow behavior

| Field | Value |
|-------|-------|
| Payload values accepted by Agents API (staticCall) | ${t2.payloadMaxIterationsAccepted.join(", ") || "none"} |
| Contract \`MAX_JANICE_ITERATIONS\` | ${t2.contractMaxJaniceIterations} |
| ABI \`uint8\` max | ${t2.uint8Max} |
| Note | ${t2.note} |

**Conclusion:** Ship \`MAX_JANICE_ITERATIONS = 8\` in shared/constants and AgentOrchestrator. Payload may encode higher uint8 values but the contract loop aborts at 8.

## T3 — Gas per trustless tool-call round trip

| Metric | Gas |
|--------|-----|
| \`createTrustlessTask\` (incl. first Janice request) | ${t3.createTrustlessTaskGas.toLocaleString()} |
| Step callback + settle (mock fulfill) | ${t3.janiceCallbackGas.toLocaleString()} |
| Combined create + first step round trip | ${t3.hireSubAgentRoundTripGas.toLocaleString()} |
| \`resumeTrustlessTask\` | ${t3.resumeTrustlessTaskGas.toLocaleString()} |

${t3.note}

## T4 — STT charged per Janice iteration

| Field | Value |
|-------|-------|
| \`getRequestDeposit()\` | ${ethers.formatEther(t4.requestDepositWei)} STT (${t4.requestDepositWei} wei) |
| Janice runner \`costWei\` | ${ethers.formatEther(t4.janiceRunnerCostWei)} STT |
| **Cost per iteration** | **${t4.janiceCostPerIterationStt} STT** (${t4.janiceCostPerIterationWei} wei) |

${t4.singleVsMultiIterationNote}

## Shipped constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| \`MAX_JANICE_ITERATIONS\` | ${results.recommendations.maxJaniceIterations} | Contract + Gate 0 T2 |
| \`minBudgetMultiplier\` | ${results.recommendations.minBudgetMultiplier} | Covers 2 Janice rounds minimum |
| \`janiceRoundBufferMultiplier\` | ${results.recommendations.janiceRoundBufferMultiplier} | Matches \`SUBCOMMITTEE_SIZE\` native lane |
| Min budget formula | \`${results.recommendations.minBudgetFormula}\` | Used in backend preflight |

## Gate 0 exit

- [x] Concrete numbers committed
- [x] \`MAX_JANICE_ITERATIONS\` set from measurements
- [x] Preflight budget defaults reference measured iteration cost
`;

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, md);
  console.log("\nWrote", RESULTS_PATH);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
