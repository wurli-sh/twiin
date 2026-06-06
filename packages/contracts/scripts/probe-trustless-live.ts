import { readFileSync } from "fs";
import { join } from "path";
import { ethers, network } from "hardhat";
import { deriveTwiinAccount } from "../test/helpers";

type Manifest = {
  addresses: {
    registry6551: string;
    twiinAccountImpl: string;
    twiinAgent: string;
    factory: string;
    policy: string;
    orchestrator: string;
  };
};

function repoPath(...parts: string[]) {
  return join(__dirname, "..", "..", "..", ...parts);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const manifest = JSON.parse(
    readFileSync(
      repoPath("packages", "shared", "deployments", `${network.name}.json`),
      "utf8",
    ),
  ) as Manifest;

  const [signer] = await ethers.getSigners();
  console.log("Probe signer:", signer.address);
  console.log("Orchestrator:", manifest.addresses.orchestrator);

  const registry = await ethers.getContractAt(
    "ERC6551Registry",
    manifest.addresses.registry6551,
  );
  const factory = await ethers.getContractFactory("TwiinFactory");
  const factoryContract = factory.attach(manifest.addresses.factory);
  const policy = await ethers.getContractAt(
    "AgentPolicy",
    manifest.addresses.policy,
  );
  const orchestrator = await ethers.getContractAt(
    "AgentOrchestrator",
    manifest.addresses.orchestrator,
  );

  const agentName = `probe-${Date.now().toString().slice(-6)}`;
  console.log("Deploying Twiin agent:", agentName);
  const deployTx = await factoryContract.deployTwiin(agentName, {
    value: ethers.parseEther("3"),
  });
  const deployReceipt = await deployTx.wait();
  const deployed = deployReceipt!.logs
    .map((log) => {
      try {
        return factoryContract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "TwiinDeployed");
  if (!deployed) throw new Error("TwiinDeployed event missing");
  const agentId = deployed.args.personalAgentId as bigint;
  console.log("Agent id:", agentId.toString());

  await (await policy.toggleKillSwitch(agentId, false)).wait();

  const accountAddr = await deriveTwiinAccount(
    registry,
    manifest.addresses.twiinAccountImpl,
    manifest.addresses.twiinAgent,
    agentId,
  );
  const account = await ethers.getContractAt("TwiinAccount", accountAddr);
  const budget = ethers.parseEther("2");
  const goal = "Summarize Somnia testnet status in one sentence.";
  const calldata = orchestrator.interface.encodeFunctionData(
    "createTrustlessTask",
    [
      agentId,
      ethers.AbiCoder.defaultAbiCoder().encode(["string"], [goal]),
      budget,
    ],
  );

  console.log("Creating trustless task...");
  const createTx = await account.execute(
    manifest.addresses.orchestrator,
    budget,
    calldata,
    0,
  );
  const createReceipt = await createTx.wait();
  const taskCreated = createReceipt!.logs
    .map((log) => {
      try {
        return orchestrator.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "TaskCreated");
  if (!taskCreated) throw new Error("TaskCreated event missing");
  const taskId = taskCreated.args.taskId as bigint;
  console.log("Task id:", taskId.toString());

  let sawJaniceIteration = false;
  let sawStepAppend = false;
  let sawResumeQueued = false;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const task = await orchestrator.tasks(taskId);
    const ctx = await orchestrator.trustlessCtx(taskId);
    const stepCount = Number(task.steps?.length ?? 0);
    console.log(
      `poll state=${task.state} awaiting=${ctx.awaiting} iterations=${ctx.iterations} steps=${stepCount}`,
    );

    if (ctx.iterations > 0n) sawJaniceIteration = true;
    if (stepCount > 0) sawStepAppend = true;
    if (ctx.awaiting === 2n) sawResumeQueued = true;

    if (task.state === 3n) {
      console.log("FAIL: task aborted");
      process.exit(1);
    }
    if (task.state === 2n) {
      console.log("PASS: trustless task completed end-to-end");
      process.exit(0);
    }

    await sleep(10_000);
  }

  if (sawJaniceIteration && sawResumeQueued) {
    console.log(
      "PARTIAL: janice loop and resume state observed, but task did not complete within timeout",
    );
    process.exit(0);
  }
  if (sawJaniceIteration) {
    console.log(
      "PARTIAL: janice iteration observed without immediate abort (likely waiting on keeper/API)",
    );
    process.exit(0);
  }

  console.log(
    "TIMEOUT: no janice progress observed — check backend keepers and Somnia Agents API",
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
