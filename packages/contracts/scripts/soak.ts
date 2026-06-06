import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

type DeploymentManifest = {
  addresses: {
    registry6551: string;
    twiinAccountImpl: string;
    twiinAgent: string;
    agentRegistry: string;
    factory: string;
    policy: string;
    orchestrator: string;
  };
};

const CAP_WEB_SCRAPE_DISCORD = ethers.keccak256(
  ethers.toUtf8Bytes("web.scrape.discord"),
);

function repoPath(...parts: string[]) {
  return join(__dirname, "..", "..", "..", ...parts);
}

function loadManifest(): DeploymentManifest {
  const path = repoPath("packages", "shared", "deployments", `${network.name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentManifest;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [signer] = await ethers.getSigners();
  const manifest = loadManifest();
  const rounds = Number(process.env.SOAK_ROUNDS ?? 3);
  const agentCount = Number(process.env.SOAK_AGENT_COUNT ?? 2);
  const refreshPeriod = Number(process.env.SOAK_REFRESH_PERIOD ?? 6);
  const taskBudget = ethers.parseEther(process.env.SOAK_TASK_BUDGET ?? "0.2");
  const stepCost = ethers.parseEther(process.env.SOAK_STEP_COST ?? "0.15");

  const registry = await ethers.getContractAt(
    "ERC6551Registry",
    manifest.addresses.registry6551,
  );
  const factory = await ethers.getContractAt(
    "TwiinFactory",
    manifest.addresses.factory,
  );
  const policy = await ethers.getContractAt(
    "AgentPolicy",
    manifest.addresses.policy,
  );
  const orchestrator = await ethers.getContractAt(
    "AgentOrchestrator",
    manifest.addresses.orchestrator,
  );
  const agentRegistry = await ethers.getContractAt(
    "AgentRegistry",
    manifest.addresses.agentRegistry,
  );

  console.log("Running soak on", network.name, "with signer", signer.address);

  const extName = `soak-${Date.now().toString().slice(-6)}`;
  const registerTx = await agentRegistry.registerExternalAgent(
    extName,
    `https://example.com/${extName}`,
    stepCost,
    [CAP_WEB_SCRAPE_DISCORD],
    { value: ethers.parseEther("5") },
  );
  await registerTx.wait();
  const externalConfigId = (await agentRegistry.nextConfigId()) - 1n;
  console.log("Registered external soak operator configId:", externalConfigId.toString());

  const agentIds: bigint[] = [];
  const accounts: string[] = [];
  for (let i = 0; i < agentCount; i++) {
    const name = `soak-agent-${Date.now().toString().slice(-4)}-${i}`;
    const tx = await factory.deployTwiin(name, { value: ethers.parseEther("2") });
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "TwiinDeployed");
    const agentId = event!.args.personalAgentId as bigint;
    agentIds.push(agentId);

    await policy.toggleKillSwitch(agentId, false);
    const acctAddr = await registry.account(
      manifest.addresses.twiinAccountImpl,
      ethers.ZeroHash,
      (await ethers.provider.getNetwork()).chainId,
      manifest.addresses.twiinAgent,
      agentId,
    );
    accounts.push(acctAddr);
    const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
  await acct.subscribePull(
      manifest.addresses.refreshManager,
      taskBudget,
      refreshPeriod,
    );
  }

  const refreshManager = await ethers.getContractAt(
    "AgentRefreshCoordinator",
    manifest.addresses.refreshManager,
  );

  const templateHash = await refreshManager.registerTaskTemplate.staticCall(
    [
      {
        subAgentConfigId: externalConfigId,
        payload: ethers.toUtf8Bytes("soak-refresh"),
        maxCostWei: taskBudget,
        timeoutSeconds: 900,
      },
    ],
    taskBudget,
  );
  await refreshManager.registerTaskTemplate(
    [
      {
        subAgentConfigId: externalConfigId,
        payload: ethers.toUtf8Bytes("soak-refresh"),
        maxCostWei: taskBudget,
        timeoutSeconds: 900,
      },
    ],
    taskBudget,
  );

  console.log("Template registered:", templateHash);

  for (let round = 0; round < rounds; round++) {
    console.log(`Round ${round + 1}/${rounds}`);
    for (let i = 0; i < agentIds.length; i++) {
      const refreshTx = await refreshManager.refreshFromTemplateByKeeper(
        agentIds[i],
        `soak-topic-${i}`,
        templateHash,
      );
      const receipt = await refreshTx.wait();
      const reqLog = receipt!.logs
        .map((l) => {
          try {
            return orchestrator.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e?.name === "ExternalAgentRequest");
      if (!reqLog) {
        throw new Error(`missing ExternalAgentRequest in round ${round} agent ${i}`);
      }

      const taskId = reqLog.args.taskId as bigint;
      const reqId = reqLog.args.reqId as string;
      const digest = ethers.solidityPackedKeccak256(
        ["string", "uint256", "address", "uint256", "uint8", "bytes32", "bytes32"],
        [
          "\x19Twiin External Result v1\n",
          (await ethers.provider.getNetwork()).chainId,
          await orchestrator.getAddress(),
          taskId,
          0,
          reqId,
          ethers.keccak256(ethers.toUtf8Bytes(`soak-result-${round}-${i}`)),
        ],
      );
      const signature = await signer.signMessage(ethers.getBytes(digest));
      await orchestrator.submitExternalResult(
        taskId,
        0,
        ethers.toUtf8Bytes(`soak-result-${round}-${i}`),
        signature,
      );
      await orchestrator.finalizeExternalStep(taskId, 0, 90);

      console.log(`  agent ${agentIds[i].toString()} task ${taskId.toString()} completed`);
      await sleep((refreshPeriod + 1) * 1000);
    }
  }

  console.log("Soak complete. Agent accounts:");
  for (let i = 0; i < accounts.length; i++) {
    console.log(`  ${agentIds[i].toString()}: ${accounts[i]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
