import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAll,
  deriveTwiinAccount,
  CAP_JSON_FETCH,
  signExternalResult,
} from "./helpers";
import type { Deployment } from "./helpers";
import type { TwiinAccount } from "../typechain-types";

async function setupLiveAgent(d: Deployment) {
  const [, , user] = await ethers.getSigners();
  await d.factory
    .connect(user)
    .deployTwiin("taskuser", { value: ethers.parseEther("5") });
  const agentId = 1n;
  await d.policy.connect(user).toggleKillSwitch(agentId, false);
  const acctAddr = await deriveTwiinAccount(
    d.registry6551,
    d.twiinAccountImpl,
    await d.twiinAgent.getAddress(),
    agentId,
  );
  const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
  return { user, agentId, acctAddr, acct };
}

function nativeStep(timeoutSeconds = 900) {
  return {
    subAgentConfigId: 2n,
    payload: "0x",
    maxCostWei: ethers.parseEther("0.5"),
    timeoutSeconds,
  };
}

async function createTaskThroughAccount(
  d: Deployment,
  agentId: bigint,
  acct: TwiinAccount,
  budget = ethers.parseEther("0.5"),
  step = nativeStep(),
) {
  const orchAddr = await d.orchestrator.getAddress();
  const createCalldata = d.orchestrator.interface.encodeFunctionData(
    "createTask",
    [agentId, [step], budget, 0],
  );
  await acct.execute(orchAddr, budget, createCalldata, 0);
}

describe("AgentOrchestrator — task lifecycle", () => {
  it("createTask rejects non-6551-agent caller", async () => {
    const d = await deployAll();
    const { agentId } = await setupLiveAgent(d);
    const [, , , attacker] = await ethers.getSigners();

    await expect(
      d.orchestrator
        .connect(attacker)
        .createTask(agentId, [nativeStep()], ethers.parseEther("0.5"), 0, {
          value: ethers.parseEther("0.5"),
        }),
    ).to.be.revertedWith("not agent");
  });

  it("createTask rejects msg.value != budgetWei", async () => {
    const d = await deployAll();
    const { user, agentId, acct } = await setupLiveAgent(d);
    const orchAddr = await d.orchestrator.getAddress();

    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [agentId, [nativeStep()], ethers.parseEther("0.5"), 0],
    );
    await expect(
      acct
        .connect(user)
        .execute(orchAddr, ethers.parseEther("0.3"), createCalldata, 0),
    ).to.be.reverted;
  });

  it("createTask rejects step count 0 and > 8", async () => {
    const d = await deployAll();
    const { user, agentId, acct } = await setupLiveAgent(d);
    const orchAddr = await d.orchestrator.getAddress();

    const zeroSteps = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [agentId, [], ethers.parseEther("0.5"), 0],
    );
    await expect(
      acct
        .connect(user)
        .execute(orchAddr, ethers.parseEther("0.5"), zeroSteps, 0),
    ).to.be.reverted;

    const step = nativeStep();
    const nineSteps = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [agentId, Array(9).fill(step), ethers.parseEther("0.9"), 0],
    );
    await expect(
      acct
        .connect(user)
        .execute(orchAddr, ethers.parseEther("0.9"), nineSteps, 0),
    ).to.be.reverted;
  });

  it("taskLock prevents concurrent tasks", async () => {
    const d = await deployAll({ useMockApi: true });
    const { user, agentId, acct } = await setupLiveAgent(d);

    await createTaskThroughAccount(
      d,
      agentId,
      acct.connect(user),
      ethers.parseEther("1"),
    );
    expect(await d.orchestrator.taskLock(agentId)).to.equal(1n);

    await expect(
      createTaskThroughAccount(d, agentId, acct.connect(user)),
    ).to.be.revertedWith("task already active");
  });

  it("NFT transfer blocked while taskLock != 0", async () => {
    const d = await deployAll({ useMockApi: true });
    const { user, agentId, acct } = await setupLiveAgent(d);
    const [, , , buyer] = await ethers.getSigners();

    await createTaskThroughAccount(d, agentId, acct.connect(user));

    await expect(
      d.twiinAgent
        .connect(user)
        .transferFrom(user.address, buyer.address, agentId),
    ).to.be.revertedWith("task in flight");
  });

  it("burn is forbidden", async () => {
    const d = await deployAll();
    const { user, agentId } = await setupLiveAgent(d);

    await expect(
      d.twiinAgent
        .connect(user)
        .transferFrom(user.address, ethers.ZeroAddress, agentId),
    ).to.be.reverted;
  });

  it("reportBadSignature selector does not exist", async () => {
    const d = await deployAll();
    const names = d.orchestrator.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name ?? "");
    expect(names.some((n) => n === "reportBadSignature")).to.be.false;
  });

  it("completeTask sweeps unused budget to 6551 account", async () => {
    const d = await deployAll({ useMockApi: true });
    const { user, agentId, acctAddr, acct } = await setupLiveAgent(d);
    const mockApi = d.mockApi!;
    const initialBal = await ethers.provider.getBalance(acctAddr);
    const budget = ethers.parseEther("0.5");

    await createTaskThroughAccount(d, agentId, acct.connect(user), budget);
    const lockedAfterCreate = await d.vault.taskLockedAmount(1n);

    await mockApi.fulfill(1n, ethers.toUtf8Bytes("done"));

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(2n);
    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);
    expect(await d.vault.taskLockedAmount(1n)).to.equal(0n);
    expect(await ethers.provider.getBalance(acctAddr)).to.equal(
      initialBal - budget + lockedAfterCreate,
    );
  });

  it("late native callbacks are ignored after timeoutTask aborts", async () => {
    const d = await deployAll({ useMockApi: true });
    const { user, agentId, acct } = await setupLiveAgent(d);
    const mockApi = d.mockApi!;

    await createTaskThroughAccount(
      d,
      agentId,
      acct.connect(user),
      ethers.parseEther("0.5"),
      nativeStep(4_000),
    );

    await ethers.provider.send("evm_increaseTime", [1_801]);
    await ethers.provider.send("evm_mine", []);
    await d.orchestrator.timeoutTask(1n);

    expect((await d.orchestrator.tasks(1n)).state).to.equal(3n);
    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);

    await mockApi.fulfill(1n, ethers.toUtf8Bytes("late result"));

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(3n);
    expect(task.cursor).to.equal(0n);
    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);
  });

  it("failed native steps retry onto the next capable agent", async () => {
    const d = await deployAll({ useMockApi: true });
    const { user, agentId, acct } = await setupLiveAgent(d);
    const mockApi = d.mockApi!;
    const [, keeper, , , externalOp] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    await d.agentRegistry
      .connect(externalOp)
      .registerExternalAgent(
        "json-fallback",
        "http://json-fallback.test",
        ethers.parseEther("0.2"),
        [CAP_JSON_FETCH],
        { value: ethers.parseEther("5") },
      );

    await createTaskThroughAccount(
      d,
      agentId,
      acct.connect(user),
      ethers.parseEther("1"),
    );
    const mockApiAddr = await mockApi.getAddress();
    await ethers.provider.send("hardhat_setBalance", [
      mockApiAddr,
      "0x" + ethers.parseEther("1").toString(16),
    ]);
    const mockApiSigner = await ethers.getImpersonatedSigner(mockApiAddr);
    const emptyRequest = {
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
    const failTx = await d.orchestrator
      .connect(mockApiSigner)
      .handleResponse(1n, [], 3, emptyRequest);
    const failReceipt = await failTx.wait();

    const taskMid = await d.orchestrator.tasks(1n);
    expect(taskMid.state).to.equal(1n);
    expect(taskMid.cursor).to.equal(0n);
    expect((await d.agentRegistry.get(2n)).tasksFailed).to.equal(1n);
    expect((await d.agentRegistry.get(6n)).registrant).to.equal(externalOp.address);

    const requestLog = failReceipt!.logs
      .map((l) => {
        try {
          return d.orchestrator.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "ExternalAgentRequest");
    expect(requestLog).to.not.equal(null);
    const reqId = requestLog!.args.reqId as string;
    const result = ethers.toUtf8Bytes("retry-result");
    const signature = await signExternalResult(
      externalOp,
      await d.orchestrator.getAddress(),
      1n,
      0,
      reqId,
      result,
      chainId,
    );

    await d.orchestrator.submitExternalResult(1n, 0, result, signature);
    await d.orchestrator.connect(keeper).finalizeExternalStep(1n, 0, 80);

    expect((await d.orchestrator.tasks(1n)).state).to.equal(2n);
    expect((await d.agentRegistry.get(6n)).tasksCompleted).to.equal(1n);
  });

  it("aborted external tasks release same-day daily budget", async () => {
    const d = await deployAll();
    const { user, agentId, acct } = await setupLiveAgent(d);
    const [, , , , externalOp] = await ethers.getSigners();

    await d.agentRegistry
      .connect(externalOp)
      .registerExternalAgent(
        "daily-reset",
        "http://daily-reset.test",
        ethers.parseEther("0.2"),
        [CAP_JSON_FETCH],
        { value: ethers.parseEther("5") },
      );

    const budget = ethers.parseEther("1");
    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [
        agentId,
        [
          {
            subAgentConfigId: 6n,
            payload: ethers.toUtf8Bytes("daily"),
            maxCostWei: ethers.parseEther("0.3"),
            timeoutSeconds: 1,
          },
        ],
        budget,
        0,
      ],
    );

    await acct
      .connect(user)
      .execute(await d.orchestrator.getAddress(), budget, createCalldata, 0);

    expect(await d.policy.canReserveTaskBudget(0, agentId, ethers.parseEther("1.1"))).to.equal(false);

    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);
    await d.orchestrator.timeoutExternalStep(1n, 0);

    expect((await d.orchestrator.tasks(1n)).state).to.equal(3n);
    expect(await d.policy.canReserveTaskBudget(0, agentId, ethers.parseEther("1"))).to.equal(true);
  });

  it("timeoutTask is permissionless after TASK_DEADLINE", async () => {
    const d = await deployAll();
    await expect(d.orchestrator.timeoutTask(999n)).to.be.revertedWith(
      "not running",
    );
  });

  it("timeoutExternalStep reverts on non-existent task", async () => {
    const d = await deployAll();
    await expect(
      d.orchestrator.timeoutExternalStep(999n, 0),
    ).to.be.revertedWith("task not running");
  });

  it("timeoutNativeStep reverts on non-existent task", async () => {
    const d = await deployAll();
    await expect(d.orchestrator.timeoutNativeStep(999n, 0)).to.be.revertedWith(
      "task not running",
    );
  });
});
