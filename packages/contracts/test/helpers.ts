import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  ERC6551Registry,
  TwiinAgent,
  TwiinAccount__factory,
  TwiinAccount,
  TwiinNames,
  AgentRegistry,
  AgentVault,
  AgentPolicy,
  OracleFeed,
  AgentOrchestrator,
  TwiinFactory,
  MockERC20,
  MockUniswapV2Router02,
  MockAgentsApi,
} from "../typechain-types";

// Capability IDs — must match deploy script seeds
export const CAP_WEB_SCRAPE = ethers.keccak256(
  ethers.toUtf8Bytes("web.scrape"),
);
export const CAP_WEB_SCRAPE_DISCORD = ethers.keccak256(
  ethers.toUtf8Bytes("web.scrape.discord"),
);
export const CAP_JSON_FETCH = ethers.keccak256(
  ethers.toUtf8Bytes("json.fetch"),
);
export const CAP_LLM_ANALYZE = ethers.keccak256(
  ethers.toUtf8Bytes("llm.analyze"),
);
export const CAP_LLM_REPORT = ethers.keccak256(
  ethers.toUtf8Bytes("llm.report"),
);
export const CAP_DATA_SPECIALIZED = ethers.keccak256(
  ethers.toUtf8Bytes("data.specialized"),
);
export const CAP_ORACLE_PUBLISH = ethers.keccak256(
  ethers.toUtf8Bytes("oracle.publish"),
);
export const CAP_ONCHAIN_EXECUTE = ethers.keccak256(
  ethers.toUtf8Bytes("onchain.execute"),
);
export const CAP_PLAN_TRUSTLESS = ethers.keccak256(
  ethers.toUtf8Bytes("plan.trustless"),
);

export const TWIIN_6551_SALT = ethers.ZeroHash;

export interface Deployment {
  registry6551: ERC6551Registry;
  twiinAgent: TwiinAgent;
  twiinAccountImpl: string;
  twiinNames: TwiinNames;
  agentRegistry: AgentRegistry;
  vault: AgentVault;
  policy: AgentPolicy;
  feed: OracleFeed;
  orchestrator: AgentOrchestrator;
  factory: TwiinFactory;
  mUSDC: MockERC20;
  mockRouter: MockUniswapV2Router02;
  admin: SignerWithAddress;
  keeper: SignerWithAddress;
  deployer: SignerWithAddress;
  mockApi?: MockAgentsApi;
}

export interface DeployOptions {
  useMockApi?: boolean;
}

export async function deployAll(options: DeployOptions = {}): Promise<Deployment> {
  const [deployer, keeper, ...rest] = await ethers.getSigners();
  const admin = deployer;

  // 1. Deploy local ERC-6551 Registry
  const Registry6551F = await ethers.getContractFactory("ERC6551Registry");
  const registry6551 = (await Registry6551F.deploy()) as ERC6551Registry;

  // 2. Deploy mUSDC and mock router (need these addresses for policy seed)
  const MockERC20F = await ethers.getContractFactory("MockERC20");
  const mUSDC = (await MockERC20F.deploy("Mock USDC", "mUSDC")) as MockERC20;

  const MockRouterF = await ethers.getContractFactory("MockUniswapV2Router02");
  const mockRouter = (await MockRouterF.deploy(
    await mUSDC.getAddress(),
  )) as MockUniswapV2Router02;

  // Pre-fund mock router with mUSDC for swaps
  await mUSDC.mint(
    await mockRouter.getAddress(),
    ethers.parseUnits("1000000", 18),
  );

  // 3. Deploy identity layer
  const TwiinAgentF = await ethers.getContractFactory("TwiinAgent");
  const twiinAgent = (await TwiinAgentF.deploy()) as TwiinAgent;

  const TwiinAccountImplF = await ethers.getContractFactory("TwiinAccount");
  const twiinAccountImplContract = (await TwiinAccountImplF.deploy(
    await twiinAgent.getAddress(),
  )) as TwiinAccount;
  const twiinAccountImpl = await twiinAccountImplContract.getAddress();

  const TwiinNamesF = await ethers.getContractFactory("TwiinNames");
  const twiinNames = (await TwiinNamesF.deploy()) as TwiinNames;

  // 4. Deploy orchestration layer
  const AgentRegistryF = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = (await AgentRegistryF.deploy()) as AgentRegistry;

  const AgentVaultF = await ethers.getContractFactory("AgentVault");
  const vault = (await AgentVaultF.deploy()) as AgentVault;

  const AgentPolicyF = await ethers.getContractFactory("AgentPolicy");
  const policy = (await AgentPolicyF.deploy()) as AgentPolicy;

  const OracleFeedF = await ethers.getContractFactory("OracleFeed");
  const feed = (await OracleFeedF.deploy()) as OracleFeed;

  let mockApi: MockAgentsApi | undefined;
  let agentsApiAddr = ethers.ZeroAddress;
  if (options.useMockApi) {
    const MockApiF = await ethers.getContractFactory("MockAgentsApi");
    mockApi = (await MockApiF.deploy()) as MockAgentsApi;
    agentsApiAddr = await mockApi.getAddress();
  }

  // Stub agentsApi at zero address unless a live mock is requested.
  const AgentOrchestratorF =
    await ethers.getContractFactory("AgentOrchestrator");
  const orchestrator = (await AgentOrchestratorF.deploy(
    await registry6551.getAddress(),
    twiinAccountImpl,
    await twiinAgent.getAddress(),
    await agentRegistry.getAddress(),
    await vault.getAddress(),
    await policy.getAddress(),
    await feed.getAddress(),
    agentsApiAddr,
    keeper.address,
    admin.address,
  )) as AgentOrchestrator;

  // 5. Deploy TwiinFactory
  const TwiinFactoryF = await ethers.getContractFactory("TwiinFactory");
  const factory = (await TwiinFactoryF.deploy(
    await registry6551.getAddress(),
    await twiinAgent.getAddress(),
    twiinAccountImpl,
    await twiinNames.getAddress(),
    await agentRegistry.getAddress(),
    await vault.getAddress(),
    await policy.getAddress(),
    await feed.getAddress(),
    await orchestrator.getAddress(),
    await mUSDC.getAddress(),
    await mockRouter.getAddress(),
  )) as TwiinFactory;

  const factoryAddr = await factory.getAddress();
  const orchestratorAddr = await orchestrator.getAddress();
  const registryAddr = await agentRegistry.getAddress();

  // 6. Wire one-shot setters
  await twiinAgent.setOrchestrator(orchestratorAddr);
  await twiinNames.setTwiinAgent(await twiinAgent.getAddress());
  await twiinNames.setRegistry(registryAddr);
  await agentRegistry.setOrchestrator(orchestratorAddr);
  await agentRegistry.setTwiinNames(await twiinNames.getAddress());
  await vault.setOrchestrator(orchestratorAddr);
  await policy.setOrchestrator(orchestratorAddr);
  await policy.setTwiinAgent(await twiinAgent.getAddress());
  await feed.setOrchestrator(orchestratorAddr);

  // Wire factory address into TwiinAgent, TwiinNames, and AgentPolicy
  await twiinAgent.setFactory(factoryAddr);
  await twiinNames.setFactory(factoryAddr);
  await policy.setFactory(factoryAddr);

  // 7. Register capabilities
  const caps = [
    { id: CAP_WEB_SCRAPE, name: "web.scrape", tier: 0, nativeOnly: false },
    {
      id: CAP_WEB_SCRAPE_DISCORD,
      name: "web.scrape.discord",
      tier: 0,
      nativeOnly: false,
    },
    { id: CAP_JSON_FETCH, name: "json.fetch", tier: 0, nativeOnly: false },
    { id: CAP_LLM_ANALYZE, name: "llm.analyze", tier: 0, nativeOnly: false },
    { id: CAP_LLM_REPORT, name: "llm.report", tier: 0, nativeOnly: false },
    {
      id: CAP_DATA_SPECIALIZED,
      name: "data.specialized",
      tier: 0,
      nativeOnly: false,
    },
    {
      id: CAP_ORACLE_PUBLISH,
      name: "oracle.publish",
      tier: 2,
      nativeOnly: true,
    },
    {
      id: CAP_ONCHAIN_EXECUTE,
      name: "onchain.execute",
      tier: 2,
      nativeOnly: true,
    },
    {
      id: CAP_PLAN_TRUSTLESS,
      name: "plan.trustless",
      tier: 2,
      nativeOnly: true,
    },
  ];
  for (const cap of caps) {
    await agentRegistry
      .connect(deployer)
      .registerCapability(cap.id, cap.name, cap.tier, cap.nativeOnly);
  }

  // 8. Register native sub-agents (configIds 0–5) — use dummy Somnia IDs for tests
  const DUMMY_SOMNIA_ID = BigInt("12847293847561029384");
  const nativeAgents = [
    {
      id: 0,
      name: "janice",
      somniaId: DUMMY_SOMNIA_ID,
      cost: ethers.parseEther("0.24"),
      caps: [CAP_PLAN_TRUSTLESS],
      tier: 2,
    },
    {
      id: 1,
      name: "web-intel",
      somniaId: BigInt("12875401142070969085"),
      cost: ethers.parseEther("0.33"),
      caps: [CAP_WEB_SCRAPE],
      tier: 1,
    },
    {
      id: 2,
      name: "somnia-oracle",
      somniaId: BigInt("13174292974160097713"),
      cost: ethers.parseEther("0.12"),
      caps: [CAP_JSON_FETCH],
      tier: 1,
    },
    {
      id: 3,
      name: "analysis-bot",
      somniaId: DUMMY_SOMNIA_ID,
      cost: ethers.parseEther("0.24"),
      caps: [CAP_LLM_ANALYZE],
      tier: 1,
    },
    {
      id: 4,
      name: "reporter-bot",
      somniaId: DUMMY_SOMNIA_ID,
      cost: ethers.parseEther("0.24"),
      caps: [CAP_LLM_REPORT],
      tier: 1,
    },
    {
      id: 5,
      name: "executor-bot",
      somniaId: DUMMY_SOMNIA_ID,
      cost: ethers.parseEther("0.24"),
      caps: [CAP_ONCHAIN_EXECUTE],
      tier: 2,
    },
  ];
  for (const a of nativeAgents) {
    await agentRegistry
      .connect(deployer)
      .registerNative(a.id, a.name, a.somniaId, "0x", a.cost, a.caps, a.tier);
  }

  // 9. Reserve core names
  const reserved = [
    "janice",
    "web-intel",
    "somnia-oracle",
    "analysis-bot",
    "reporter-bot",
    "executor-bot",
  ];
  for (const name of reserved) {
    await agentRegistry.reserveSubAgentName(name);
  }

  return {
    registry6551,
    twiinAgent,
    twiinAccountImpl,
    twiinNames,
    agentRegistry,
    vault,
    policy,
    feed: feed,
    orchestrator,
    factory,
    mUSDC,
    mockRouter,
    admin,
    keeper,
    deployer,
    mockApi,
  };
}

// Derive the deterministic 6551 address for a given agent ID.
export async function deriveTwiinAccount(
  registry6551: ERC6551Registry,
  twiinAccountImpl: string,
  twiinAgentAddr: string,
  personalAgentId: bigint,
): Promise<string> {
  return registry6551.account(
    twiinAccountImpl,
    TWIIN_6551_SALT,
    (await ethers.provider.getNetwork()).chainId,
    twiinAgentAddr,
    personalAgentId,
  );
}

// Sign an external result digest matching AgentOrchestrator.submitExternalResult.
export async function signExternalResult(
  signer: SignerWithAddress,
  orchestratorAddr: string,
  taskId: bigint,
  stepIdx: number,
  externalRequestId: string,
  result: Uint8Array | string,
  chainId: bigint,
): Promise<string> {
  const resultBytes =
    typeof result === "string" ? ethers.toUtf8Bytes(result) : result;
  const resultHash = ethers.keccak256(resultBytes);
  const digest = ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256", "uint8", "bytes32", "bytes32"],
    [
      "\x19Twiin External Result v1\n",
      chainId,
      orchestratorAddr,
      taskId,
      stepIdx,
      externalRequestId,
      resultHash,
    ],
  );
  return signer.signMessage(ethers.getBytes(digest));
}
