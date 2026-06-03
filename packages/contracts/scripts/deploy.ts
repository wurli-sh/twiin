import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Confirmed Somnia testnet agent IDs (recovered from on-chain logs 2026-05-30)
const LLM_INFERENCE_ID = BigInt("12847293847561029384");
const PARSE_WEB_ID = BigInt("12875401142070969085");
const JSON_API_ID = BigInt("13174292974160097713");

const CAP = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "STT",
  );

  // ─── 1. Mocks ─────────────────────────────────────────────────────────────
  console.log("\n[1/7] Deploying mocks…");
  const MockERC20F = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20F.deploy("Mock USDC", "mUSDC");
  await mUSDC.waitForDeployment();
  console.log("  mUSDC:", await mUSDC.getAddress());

  const MockRouterF = await ethers.getContractFactory("MockUniswapV2Router02");
  const mockRouter = await MockRouterF.deploy(await mUSDC.getAddress());
  await mockRouter.waitForDeployment();
  console.log("  MockRouter:", await mockRouter.getAddress());

  // Pre-fund router with mUSDC for demo swaps
  await mUSDC.mint(
    await mockRouter.getAddress(),
    ethers.parseUnits("1000000", 18),
  );
  console.log("  Pre-funded router with 1M mUSDC");

  // ─── 2. Local ERC-6551 Registry ──────────────────────────────────────────
  console.log("\n[2/7] Deploying local ERC-6551 Registry…");
  const RegistryF = await ethers.getContractFactory("ERC6551Registry");
  const registry6551 = await RegistryF.deploy();
  await registry6551.waitForDeployment();
  console.log("  ERC6551Registry:", await registry6551.getAddress());

  // ─── 3. Identity layer ────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying identity layer…");

  const TwiinAgentF = await ethers.getContractFactory("TwiinAgent");
  const twiinAgent = await TwiinAgentF.deploy();
  await twiinAgent.waitForDeployment();
  console.log("  TwiinAgent:", await twiinAgent.getAddress());

  const TwiinAccountF = await ethers.getContractFactory("TwiinAccount");
  const twiinAccountImpl = await TwiinAccountF.deploy(
    await twiinAgent.getAddress(),
  );
  await twiinAccountImpl.waitForDeployment();
  console.log("  TwiinAccount impl:", await twiinAccountImpl.getAddress());

  const TwiinNamesF = await ethers.getContractFactory("TwiinNames");
  const twiinNames = await TwiinNamesF.deploy();
  await twiinNames.waitForDeployment();
  console.log("  TwiinNames:", await twiinNames.getAddress());

  // ─── 4. Orchestration layer ───────────────────────────────────────────────
  console.log("\n[4/7] Deploying orchestration layer…");

  const AgentRegistryF = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistryF.deploy();
  await agentRegistry.waitForDeployment();
  console.log("  AgentRegistry:", await agentRegistry.getAddress());

  const AgentVaultF = await ethers.getContractFactory("AgentVault");
  const vault = await AgentVaultF.deploy();
  await vault.waitForDeployment();
  console.log("  AgentVault:", await vault.getAddress());

  const AgentPolicyF = await ethers.getContractFactory("AgentPolicy");
  const policy = await AgentPolicyF.deploy();
  await policy.waitForDeployment();
  console.log("  AgentPolicy:", await policy.getAddress());

  const OracleFeedF = await ethers.getContractFactory("OracleFeed");
  const oracleFeed = await OracleFeedF.deploy();
  await oracleFeed.waitForDeployment();
  console.log("  OracleFeed:", await oracleFeed.getAddress());

  // Somnia agents API address (fixed on testnet)
  const AGENTS_API = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";
  const keeperAddr = process.env.KEEPER_ADDRESS ?? deployer.address;

  const AgentOrchestratorF =
    await ethers.getContractFactory("AgentOrchestrator");
  const orchestrator = await AgentOrchestratorF.deploy(
    await registry6551.getAddress(),
    await twiinAccountImpl.getAddress(),
    await twiinAgent.getAddress(),
    await agentRegistry.getAddress(),
    await vault.getAddress(),
    await policy.getAddress(),
    await oracleFeed.getAddress(),
    AGENTS_API,
    keeperAddr,
    deployer.address,
  );
  await orchestrator.waitForDeployment();
  console.log("  AgentOrchestrator:", await orchestrator.getAddress());

  // ─── 5. TwiinFactory ─────────────────────────────────────────────────────
  console.log("\n[5/7] Deploying TwiinFactory…");
  const TwiinFactoryF = await ethers.getContractFactory("TwiinFactory");
  const factory = await TwiinFactoryF.deploy(
    await registry6551.getAddress(),
    await twiinAgent.getAddress(),
    await twiinAccountImpl.getAddress(),
    await twiinNames.getAddress(),
    await agentRegistry.getAddress(),
    await vault.getAddress(),
    await policy.getAddress(),
    await oracleFeed.getAddress(),
    await orchestrator.getAddress(),
    await mUSDC.getAddress(),
    await mockRouter.getAddress(),
  );
  await factory.waitForDeployment();
  console.log("  TwiinFactory:", await factory.getAddress());

  // Wire factory address into TwiinAgent, TwiinNames, and AgentPolicy
  await (await twiinAgent.setFactory(await factory.getAddress())).wait();
  await (await twiinNames.setFactory(await factory.getAddress())).wait();
  await (await policy.setFactory(await factory.getAddress())).wait();
  console.log("  factory wired to TwiinAgent, TwiinNames, AgentPolicy ✓");

  // ─── 6. Wire deferred setters ─────────────────────────────────────────────
  console.log("\n[6/7] Wiring deferred setters…");

  await (
    await twiinAgent.setOrchestrator(await orchestrator.getAddress())
  ).wait();
  console.log("  TwiinAgent.setOrchestrator ✓");

  await (await twiinNames.setTwiinAgent(await twiinAgent.getAddress())).wait();
  await (await twiinNames.setRegistry(await agentRegistry.getAddress())).wait();
  console.log("  TwiinNames wired ✓");

  await (
    await agentRegistry.setOrchestrator(await orchestrator.getAddress())
  ).wait();
  await (
    await agentRegistry.setTwiinNames(await twiinNames.getAddress())
  ).wait();
  console.log("  AgentRegistry wired ✓");

  await (await vault.setOrchestrator(await orchestrator.getAddress())).wait();
  console.log("  AgentVault wired ✓");

  await (await policy.setOrchestrator(await orchestrator.getAddress())).wait();
  await (await policy.setTwiinAgent(await twiinAgent.getAddress())).wait();
  console.log("  AgentPolicy wired ✓");

  await (
    await oracleFeed.setOrchestrator(await orchestrator.getAddress())
  ).wait();
  console.log("  OracleFeed wired ✓");

  // ─── 7. Seed capabilities, native agents, reserved names ─────────────────
  console.log(
    "\n[7/7] Seeding capabilities, native agents, and reserved names…",
  );

  const capabilities = [
    { id: CAP("web.scrape"), name: "web.scrape", tier: 0, nativeOnly: false },
    {
      id: CAP("web.scrape.discord"),
      name: "web.scrape.discord",
      tier: 0,
      nativeOnly: false,
    },
    { id: CAP("json.fetch"), name: "json.fetch", tier: 0, nativeOnly: false },
    { id: CAP("llm.analyze"), name: "llm.analyze", tier: 0, nativeOnly: false },
    { id: CAP("llm.report"), name: "llm.report", tier: 0, nativeOnly: false },
    {
      id: CAP("data.specialized"),
      name: "data.specialized",
      tier: 0,
      nativeOnly: false,
    },
    {
      id: CAP("oracle.publish"),
      name: "oracle.publish",
      tier: 2,
      nativeOnly: true,
    },
    {
      id: CAP("onchain.execute"),
      name: "onchain.execute",
      tier: 2,
      nativeOnly: true,
    },
    {
      id: CAP("plan.trustless"),
      name: "plan.trustless",
      tier: 2,
      nativeOnly: true,
    },
  ];
  for (const cap of capabilities) {
    await (
      await agentRegistry.registerCapability(
        cap.id,
        cap.name,
        cap.tier,
        cap.nativeOnly,
      )
    ).wait();
  }
  console.log("  Registered 9 capabilities ✓");

  const nativeAgents = [
    {
      id: 0,
      name: "janice",
      somniaId: LLM_INFERENCE_ID,
      payload: "0x",
      cost: ethers.parseEther("0.24"),
      caps: [CAP("plan.trustless")],
      tier: 2,
    },
    {
      id: 1,
      name: "web-intel",
      somniaId: PARSE_WEB_ID,
      payload: "0x",
      cost: ethers.parseEther("0.33"),
      caps: [CAP("web.scrape")],
      tier: 1,
    },
    {
      id: 2,
      name: "somnia-oracle",
      somniaId: JSON_API_ID,
      payload: "0x",
      cost: ethers.parseEther("0.12"),
      caps: [CAP("json.fetch")],
      tier: 1,
    },
    {
      id: 3,
      name: "analysis-bot",
      somniaId: LLM_INFERENCE_ID,
      payload: "0x",
      cost: ethers.parseEther("0.24"),
      caps: [CAP("llm.analyze")],
      tier: 1,
    },
    {
      id: 4,
      name: "reporter-bot",
      somniaId: LLM_INFERENCE_ID,
      payload: "0x",
      cost: ethers.parseEther("0.24"),
      caps: [CAP("llm.report")],
      tier: 1,
    },
    {
      id: 5,
      name: "executor-bot",
      somniaId: LLM_INFERENCE_ID,
      payload: "0x",
      cost: ethers.parseEther("0.24"),
      caps: [CAP("onchain.execute")],
      tier: 2,
    },
  ];
  for (const a of nativeAgents) {
    await (
      await agentRegistry.registerNative(
        a.id,
        a.name,
        a.somniaId,
        a.payload,
        a.cost,
        a.caps,
        a.tier,
      )
    ).wait();
  }
  console.log("  Registered 6 native agents (configIds 0–5) ✓");

  const reservedNames = [
    "janice",
    "web-intel",
    "somnia-oracle",
    "analysis-bot",
    "reporter-bot",
    "executor-bot",
    "system",
    "twiin",
    "admin",
  ];
  for (const name of reservedNames) {
    await (await agentRegistry.reserveSubAgentName(name)).wait();
  }
  console.log("  Reserved", reservedNames.length, "core names ✓");

  // ─── Write addresses.json ─────────────────────────────────────────────────
  const addresses = {
    _note: "Generated by scripts/deploy.ts — do not edit by hand",
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    registry6551: await registry6551.getAddress(),
    twiinAgent: await twiinAgent.getAddress(),
    twiinAccountImpl: await twiinAccountImpl.getAddress(),
    twiinNames: await twiinNames.getAddress(),
    agentRegistry: await agentRegistry.getAddress(),
    vault: await vault.getAddress(),
    policy: await policy.getAddress(),
    oracleFeed: await oracleFeed.getAddress(),
    orchestrator: await orchestrator.getAddress(),
    factory: await factory.getAddress(),
    mUSDC: await mUSDC.getAddress(),
    mockRouter: await mockRouter.getAddress(),
  };

  const outDir = join(__dirname, "../../../shared");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "addresses.json"),
    JSON.stringify(addresses, null, 2),
  );
  console.log("\n✅ addresses.json written to packages/shared/addresses.json");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
