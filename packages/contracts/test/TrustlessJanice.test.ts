import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll, deriveTwiinAccount } from "./helpers";

async function setupAgent() {
  const d = await deployAll({ useMockApi: true });
  const [, , user] = await ethers.getSigners();
  await d.factory.connect(user).deployTwiin("trustless-user", {
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
  return { d, user, agentId, acct };
}

const toolIface = ethers.Interface.from([
  "function hireSubAgent(uint256,bytes,uint256,uint32)",
  "function completeTrustlessTask(string)",
]);

function encodeTrustlessResult(
  finishReason: string,
  pendingToolCalls: string[] = [],
  response = "",
) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "string[]", "string[]", "string[]", "bytes[]"],
    [finishReason, response, [], [], [], pendingToolCalls],
  );
}

function encodeHireSubAgentCalldata(
  configId: bigint,
  payload = "0x",
  maxCostWei = ethers.parseEther("0.5"),
  timeoutSeconds = 900,
) {
  return toolIface.encodeFunctionData("hireSubAgent", [
    configId,
    payload,
    maxCostWei,
    timeoutSeconds,
  ]);
}

function encodeCompleteCalldata(result: string) {
  return toolIface.encodeFunctionData("completeTrustlessTask", [result]);
}

function encodeInferToolsChatPayload() {
  return ethers.Interface.from([
    "function inferToolsChat(string[],string[],string[],(string,string)[],uint256,bool)",
  ]).encodeFunctionData("inferToolsChat", [
    ["system", "user"],
    ["You are Janice.", "resume"],
    [],
    [[ "completeTrustlessTask(string)", "Finish task" ]],
    8,
    false,
  ]);
}

describe("AgentOrchestrator — TrustlessJanice", () => {
  it("creates a zero-step trustless task and opens the first Janice request", async () => {
    const { d, user, agentId, acct } = await setupAgent();
    const budget = ethers.parseEther("1");
    const orchAddr = await d.orchestrator.getAddress();

    const calldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["test goal"]), budget],
    );
    await acct.connect(user).execute(orchAddr, budget, calldata, 0);

    const task = await d.orchestrator.tasks(1n);
    const trustless = await d.orchestrator.trustlessCtx(1n);
    expect(task.mode).to.equal(1n);
    expect(task.state).to.equal(1n);
    expect(task.cursor).to.equal(0n);
    expect(trustless.iterations).to.equal(0n);
    expect(trustless.awaiting).to.equal(0n);
    expect(trustless.janiceRequestId).to.equal(1n);
  });

  it("encodes the initial janice payload with Somnia inferToolsChat ABI", async () => {
    const { d, user, agentId, acct } = await setupAgent();
    const budget = ethers.parseEther("1");
    const orchAddr = await d.orchestrator.getAddress();
    const goal = 'say "gm"\nthen continue';
    const mockApiAddr = (await d.mockApi!.getAddress()).toLowerCase();

    const calldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], [goal]), budget],
    );
    const tx = await acct.connect(user).execute(orchAddr, budget, calldata, 0);
    const receipt = await tx.wait();
    const reqLog = receipt!.logs.find(
      (log) => log.address.toLowerCase() === mockApiAddr,
    );
    expect(reqLog).to.not.equal(undefined);
    const decoded = d.mockApi!.interface.parseLog({
      topics: reqLog!.topics as string[],
      data: reqLog!.data,
    });
    const payload = decoded!.args.payload as string;
    const iface = ethers.Interface.from([
      "function inferToolsChat(string[],string[],string[],(string,string)[],uint256,bool)",
    ]);
    const decodedCall = iface.decodeFunctionData("inferToolsChat", payload);
    expect(decodedCall[0]).to.deep.equal(["system", "user"]);
    expect(decodedCall[1][1]).to.equal(goal);
    expect(decodedCall[4]).to.equal(8n);
    expect(decodedCall[5]).to.equal(false);
  });

  it("runs janice -> hireSubAgent -> resume -> complete", async () => {
    const { d, user, agentId, acct } = await setupAgent();
    const mockApi = d.mockApi!;
    const budget = ethers.parseEther("1");
    const orchAddr = await d.orchestrator.getAddress();

    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["find oracle answer"]), budget],
    );
    await acct.connect(user).execute(orchAddr, budget, createCalldata, 0);

    await mockApi.fulfill(
      1n,
      encodeTrustlessResult("tool_calls", [encodeHireSubAgentCalldata(2n)]),
    );

    let trustless = await d.orchestrator.trustlessCtx(1n);
    expect(trustless.awaiting).to.equal(1n);
    expect((await d.orchestrator.tasks(1n)).cursor).to.equal(0n);

    await mockApi.fulfill(2n, ethers.toUtf8Bytes("oracle-result"));

    trustless = await d.orchestrator.trustlessCtx(1n);
    expect(trustless.awaiting).to.equal(2n);
    expect((await d.orchestrator.tasks(1n)).cursor).to.equal(1n);

    const janice = await d.agentRegistry.get(0);
    const expectedCost =
      (await mockApi.getRequestDeposit()) + janice.costWei * 3n;
    await d.orchestrator.connect(d.keeper).resumeTrustlessTask(
      1n,
      encodeInferToolsChatPayload(),
      expectedCost,
    );

    await mockApi.fulfill(
      3n,
      encodeTrustlessResult("tool_calls", [encodeCompleteCalldata("trustless-done")]),
    );

    const task = await d.orchestrator.tasks(1n);
    trustless = await d.orchestrator.trustlessCtx(1n);
    expect(task.state).to.equal(2n);
    expect(trustless.awaiting).to.equal(3n);
    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);
  });

  it("aborts when janice returns max_iterations", async () => {
    const { d, user, acct, agentId } = await setupAgent();
    const budget = ethers.parseEther("1");
    const orchAddr = await d.orchestrator.getAddress();

    const calldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["cap it"]), budget],
    );
    await acct.connect(user).execute(orchAddr, budget, calldata, 0);

    await d.mockApi!.fulfill(
      1n,
      encodeTrustlessResult("max_iterations"),
    );

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(3n);
  });

  it("allows stop on the eighth callback instead of aborting immediately", async () => {
    const { d, user, acct, agentId } = await setupAgent();
    const budget = ethers.parseEther("2");
    const orchAddr = await d.orchestrator.getAddress();
    const janice = await d.agentRegistry.get(0);
    const janiceCost =
      (await d.mockApi!.getRequestDeposit()) + janice.costWei * 3n;

    const calldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["finish on last round"]), budget],
    );
    await acct.connect(user).execute(orchAddr, budget, calldata, 0);

    let reqId = 1n;
    for (let round = 0; round < 7; round++) {
      await d.mockApi!.fulfill(reqId, encodeTrustlessResult("tool_calls", []));
      const ctx = await d.orchestrator.trustlessCtx(1n);
      expect(ctx.awaiting).to.equal(2n);
      await d.orchestrator.connect(d.keeper).resumeTrustlessTask(
        1n,
        encodeInferToolsChatPayload(),
        janiceCost,
      );
      reqId += 1n;
    }

    await d.mockApi!.fulfill(reqId, encodeTrustlessResult("stop", [], "final trustless result"));

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(2n);
  });

  it("aborts instead of silently dropping tools after a pause-producing tool", async () => {
    const { d, user, acct, agentId } = await setupAgent();
    const budget = ethers.parseEther("1");
    const orchAddr = await d.orchestrator.getAddress();

    const calldata = d.orchestrator.interface.encodeFunctionData(
      "createTrustlessTask",
      [agentId, ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["multi tool"]), budget],
    );
    await acct.connect(user).execute(orchAddr, budget, calldata, 0);

    await d.mockApi!.fulfill(
      1n,
      encodeTrustlessResult("tool_calls", [
        encodeHireSubAgentCalldata(2n),
        encodeCompleteCalldata("should-never-run"),
      ]),
    );

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(3n);
  });
});
