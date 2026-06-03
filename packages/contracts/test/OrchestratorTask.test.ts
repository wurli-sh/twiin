import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll, deriveTwiinAccount } from "./helpers";
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

    await createTaskThroughAccount(d, agentId, acct.connect(user));
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
