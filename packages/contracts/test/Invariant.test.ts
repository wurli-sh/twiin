import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CAP_JSON_FETCH,
  CAP_WEB_SCRAPE_DISCORD,
  deployAll,
  deriveTwiinAccount,
  signExternalResult,
} from "./helpers";
import type { Deployment } from "./helpers";
import type { TwiinAccount } from "../typechain-types";

type AgentCtx = {
  user: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  agentId: bigint;
  acctAddr: string;
  acct: TwiinAccount;
};

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  };
}

async function setupAgents(d: Deployment, count = 3): Promise<AgentCtx[]> {
  const signers = await ethers.getSigners();
  const agents: AgentCtx[] = [];
  for (let i = 0; i < count; i++) {
    const user = signers[i + 2];
    await d.factory
      .connect(user)
      .deployTwiin(`inv-${i}`, { value: ethers.parseEther("5") });
    const agentId = BigInt(i + 1);
    await d.policy.connect(user).toggleKillSwitch(agentId, false);
    const acctAddr = await deriveTwiinAccount(
      d.registry6551,
      d.twiinAccountImpl,
      await d.twiinAgent.getAddress(),
      agentId,
    );
    const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
    agents.push({ user, agentId, acctAddr, acct });
  }
  return agents;
}

async function createTask(
  d: Deployment,
  agent: AgentCtx,
  steps: Array<{
    subAgentConfigId: bigint;
    payload: string | Uint8Array;
    maxCostWei: bigint;
    timeoutSeconds: number;
  }>,
  budget: bigint,
) {
  const nextTaskId = (await d.orchestrator.nextTaskId()) + 1n;
  const calldata = d.orchestrator.interface.encodeFunctionData("createTask", [
    agent.agentId,
    steps,
    budget,
    0,
  ]);
  const tx = await agent.acct
    .connect(agent.user)
    .execute(await d.orchestrator.getAddress(), budget, calldata, 0);
  const receipt = await tx.wait();
  return { taskId: nextTaskId, receipt };
}

function emptyRequest() {
  return {
    id: 0n,
    requester: ethers.ZeroAddress,
    callbackAddress: ethers.ZeroAddress,
    callbackSelector: "0x00000000",
    subcommittee: [] as string[],
    responses: [] as never[],
    responseCount: 0n,
    failureCount: 0n,
    threshold: 0n,
    createdAt: 0n,
    deadline: 0n,
    status: 0,
    consensusType: 0,
    remainingBudget: 0n,
    perAgentBudget: 0n,
  };
}

function findEventArgs(
  receipt: Awaited<ReturnType<ReturnType<typeof createTask>["receipt"]>>,
  iface: typeof ethers.Interface.prototype,
  name: string,
) {
  return receipt!.logs
    .map((l) => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === name)?.args;
}

async function runNativeSuccess(d: Deployment, agent: AgentCtx) {
  const budget = ethers.parseEther("0.5");
  const before = await ethers.provider.getBalance(agent.acctAddr);
  const requestId = (await d.mockApi!.nextReqId()) + 1n;
  const { taskId } = await createTask(
    d,
    agent,
    [
      {
        subAgentConfigId: 2n,
        payload: "0x",
        maxCostWei: ethers.parseEther("0.5"),
        timeoutSeconds: 900,
      },
    ],
    budget,
  );
  await d.mockApi!.fulfill(requestId, ethers.toUtf8Bytes("native-ok"));
  const task = await d.orchestrator.tasks(taskId);
  return { taskId, before, after: await ethers.provider.getBalance(agent.acctAddr), task, budget };
}

async function runExternalAccepted(
  d: Deployment,
  agent: AgentCtx,
  operator: Awaited<ReturnType<typeof ethers.getSigners>>[6],
  keeper: Awaited<ReturnType<typeof ethers.getSigners>>[1],
  configId: bigint,
) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const budget = ethers.parseEther("0.5");
  const before = await ethers.provider.getBalance(agent.acctAddr);
  const { taskId, receipt } = await createTask(
    d,
    agent,
    [
      {
        subAgentConfigId: configId,
        payload: ethers.toUtf8Bytes("ext"),
        maxCostWei: ethers.parseEther("0.3"),
        timeoutSeconds: 900,
      },
    ],
    budget,
  );
  const reqArgs = findEventArgs(receipt, d.orchestrator.interface, "ExternalAgentRequest");
  const sig = await signExternalResult(
    operator,
    await d.orchestrator.getAddress(),
    taskId,
    0,
    reqArgs!.reqId as string,
    ethers.toUtf8Bytes("ext-ok"),
    chainId,
  );
  await d.orchestrator.submitExternalResult(taskId, 0, ethers.toUtf8Bytes("ext-ok"), sig);
  await d.orchestrator.connect(keeper).finalizeExternalStep(taskId, 0, 85);
  const task = await d.orchestrator.tasks(taskId);
  return { taskId, before, after: await ethers.provider.getBalance(agent.acctAddr), task, budget };
}

async function runExternalRejected(
  d: Deployment,
  agent: AgentCtx,
  operator: Awaited<ReturnType<typeof ethers.getSigners>>[6],
  keeper: Awaited<ReturnType<typeof ethers.getSigners>>[1],
  configId: bigint,
) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const budget = ethers.parseEther("0.5");
  const before = await ethers.provider.getBalance(agent.acctAddr);
  const { taskId, receipt } = await createTask(
    d,
    agent,
    [
      {
        subAgentConfigId: configId,
        payload: ethers.toUtf8Bytes("ext"),
        maxCostWei: ethers.parseEther("0.3"),
        timeoutSeconds: 900,
      },
    ],
    budget,
  );
  const reqArgs = findEventArgs(receipt, d.orchestrator.interface, "ExternalAgentRequest");
  const sig = await signExternalResult(
    operator,
    await d.orchestrator.getAddress(),
    taskId,
    0,
    reqArgs!.reqId as string,
    ethers.toUtf8Bytes("ext-bad"),
    chainId,
  );
  await d.orchestrator.submitExternalResult(taskId, 0, ethers.toUtf8Bytes("ext-bad"), sig);
  await d.orchestrator.connect(keeper).finalizeExternalStep(taskId, 0, 5);
  const task = await d.orchestrator.tasks(taskId);
  return { taskId, before, after: await ethers.provider.getBalance(agent.acctAddr), task, budget };
}

async function runNativeFailThenExternalAccept(
  d: Deployment,
  agent: AgentCtx,
  operator: Awaited<ReturnType<typeof ethers.getSigners>>[5],
  keeper: Awaited<ReturnType<typeof ethers.getSigners>>[1],
) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const budget = ethers.parseEther("1");
  const before = await ethers.provider.getBalance(agent.acctAddr);
  const requestId = (await d.mockApi!.nextReqId()) + 1n;
  const { taskId } = await createTask(
    d,
    agent,
    [
      {
        subAgentConfigId: 2n,
        payload: "0x",
        maxCostWei: ethers.parseEther("0.5"),
        timeoutSeconds: 900,
      },
    ],
    budget,
  );
  const mockApiAddr = await d.mockApi!.getAddress();
  await ethers.provider.send("hardhat_setBalance", [
    mockApiAddr,
    "0x" + ethers.parseEther("1").toString(16),
  ]);
  const mockApiSigner = await ethers.getImpersonatedSigner(mockApiAddr);
  const failTx = await d.orchestrator
    .connect(mockApiSigner)
    .handleResponse(requestId, [], 3, emptyRequest());
  const failReceipt = await failTx.wait();
  const reqArgs = findEventArgs(failReceipt, d.orchestrator.interface, "ExternalAgentRequest");
  const sig = await signExternalResult(
    operator,
    await d.orchestrator.getAddress(),
    taskId,
    0,
    reqArgs!.reqId as string,
    ethers.toUtf8Bytes("retry-ok"),
    chainId,
  );
  await d.orchestrator.submitExternalResult(taskId, 0, ethers.toUtf8Bytes("retry-ok"), sig);
  await d.orchestrator.connect(keeper).finalizeExternalStep(taskId, 0, 90);
  const task = await d.orchestrator.tasks(taskId);
  return { taskId, before, after: await ethers.provider.getBalance(agent.acctAddr), task, budget };
}

describe("Invariant-style budget and cleanup checks", () => {
  it("mixed scenarios preserve balance accounting and cleanup invariants", async () => {
    const d = await deployAll({ useMockApi: true });
    const signers = await ethers.getSigners();
    const keeper = signers[1];
    const jsonOperator = signers[5];
    const scrapeOperator = signers[6];
    const agents = await setupAgents(d, 3);

    await d.agentRegistry
      .connect(jsonOperator)
      .registerExternalAgent(
        "json-fallback",
        "http://json-fallback.test",
        ethers.parseEther("0.2"),
        [CAP_JSON_FETCH],
        { value: ethers.parseEther("5") },
      );
    await d.agentRegistry
      .connect(scrapeOperator)
      .registerExternalAgent(
        "scrape-check",
        "http://scrape-check.test",
        ethers.parseEther("0.2"),
        [CAP_WEB_SCRAPE_DISCORD],
        { value: ethers.parseEther("5") },
      );

    const rng = lcg(1337);
    for (let i = 0; i < 12; i++) {
      const agent = agents[i % agents.length];
      const choice = rng() % 4;
      const run =
        choice === 0
          ? await runNativeSuccess(d, agent)
          : choice === 1
            ? await runExternalAccepted(d, agent, scrapeOperator, keeper, 7n)
            : choice === 2
              ? await runExternalRejected(d, agent, scrapeOperator, keeper, 7n)
              : await runNativeFailThenExternalAccept(d, agent, jsonOperator, keeper);

      expect(run.task.spentWei).to.be.lte(run.budget);
      expect(await d.orchestrator.taskLock(agent.agentId)).to.equal(0n);
      expect(await d.vault.taskLockedAmount(run.taskId)).to.equal(0n);
      expect(run.after).to.equal(run.before - run.task.spentWei);
      expect([2n, 3n]).to.include(run.task.state);
    }
  });
});
