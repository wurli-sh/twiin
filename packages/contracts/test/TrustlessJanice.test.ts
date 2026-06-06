import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll, deriveTwiinAccount } from "./helpers";
import type { TwiinAccount } from "../typechain-types";

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

function encodeTrustlessResult(
  finishReason: string,
  toolNames: string[] = [],
  toolArgs: string[] = [],
  assistantMessage = "",
) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string[]", "bytes[]", "string"],
    [finishReason, toolNames, toolArgs, assistantMessage],
  );
}

function encodeHireSubAgent(
  configId: bigint,
  payload = "0x",
  maxCostWei = ethers.parseEther("0.5"),
  timeoutSeconds = 900,
) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes", "uint256", "uint32"],
    [configId, payload, maxCostWei, timeoutSeconds],
  );
}

function encodeComplete(result: string) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string"], [result]);
}

function encodeInferToolsChatPayload() {
  return ethers.Interface.from([
    "function inferToolsChat(string,string,string,uint8)",
  ]).encodeFunctionData("inferToolsChat", [
    "You are Janice.",
    '[{"role":"user","content":"resume"}]',
    '[{"name":"completeTrustlessTask"}]',
    8,
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

  it("escapes quotes and newlines in the initial janice message payload", async () => {
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
    const selector = payload.slice(0, 10);
    const iface = ethers.Interface.from([
      "function inferToolsChat(string,string,string,uint8)",
    ]);
    const decodedCall = iface.decodeFunctionData("inferToolsChat", payload);
    expect(selector).to.equal(iface.getFunction("inferToolsChat")!.selector);
    expect(decodedCall[1]).to.equal('[{"role":"user","content":"say \\"gm\\"\\nthen continue"}]');
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
      encodeTrustlessResult(
        "tool_calls",
        ["hireSubAgent"],
        [encodeHireSubAgent(2n, "0x", ethers.parseEther("0.5"), 900)],
      ),
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
      encodeTrustlessResult(
        "tool_calls",
        ["completeTrustlessTask"],
        [encodeComplete("trustless-done")],
      ),
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
      encodeTrustlessResult(
        "tool_calls",
        ["hireSubAgent", "completeTrustlessTask"],
        [
          encodeHireSubAgent(2n, "0x", ethers.parseEther("0.5"), 900),
          encodeComplete("should-never-run"),
        ],
      ),
    );

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(3n);
  });
});
