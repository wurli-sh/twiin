import { ethers } from "hardhat";
import {
  CAP_WEB_SCRAPE_DISCORD,
  deployAll,
  deriveTwiinAccount,
} from "../test/helpers";

async function main() {
  const d = await deployAll({ useMockApi: true });
  const [admin, , user, , , operator] = await ethers.getSigners();

  await d.agentRegistry
    .connect(operator)
    .registerExternalAgent(
      "refresh-operator",
      "http://refresh-operator.test",
      ethers.parseEther("0.15"),
      [CAP_WEB_SCRAPE_DISCORD],
      { value: ethers.parseEther("5") },
    );

  await d.factory.connect(user).deployTwiin("reactivity-probe", {
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
  await acct
    .connect(user)
    .subscribePull(await d.orchestrator.getAddress(), ethers.parseEther("0.2"), 60);

  const orchAddr = await d.orchestrator.getAddress();
  await ethers.provider.send("hardhat_setBalance", [
    orchAddr,
    "0x" + ethers.parseEther("40").toString(16),
  ]);
  const orchSigner = await ethers.getImpersonatedSigner(orchAddr);

  const step = {
    subAgentConfigId: 6n,
    payload: ethers.toUtf8Bytes("refresh-step"),
    maxCostWei: ethers.parseEther("0.2"),
    timeoutSeconds: 900,
  };
  const budget = ethers.parseEther("0.2");
  const templateHash = await d.feed
    .connect(orchSigner)
    .registerTemplate.staticCall([step], budget);
  await d.feed.connect(orchSigner).registerTemplate([step], budget);

  const publishTx = await d.orchestrator
    .connect(admin)
    .publishFeedAndMaybeSchedule(agentId, "health", "ok", 90, 600, 60, templateHash);
  const publishReceipt = await publishTx.wait();
  const publishBlock = await ethers.provider.getBlock(publishReceipt!.blockNumber);
  const timestampMillis = BigInt((publishBlock!.timestamp + 60) * 1000);

  const precompile = "0x0000000000000000000000000000000000000100";
  await ethers.provider.send("hardhat_setBalance", [
    precompile,
    "0x" + ethers.parseEther("1").toString(16),
  ]);
  const precompileSigner = await ethers.getImpersonatedSigner(precompile);

  const onEventTx = await d.orchestrator
    .connect(precompileSigner)
    .onEvent(
      precompile,
      [ethers.ZeroHash, ethers.zeroPadValue(ethers.toBeHex(timestampMillis), 32)],
      "0x",
    );
  const onEventReceipt = await onEventTx.wait();

  const parseLogs = (receipt: Awaited<ReturnType<typeof onEventTx.wait>>) =>
    receipt!.logs
      .map((log) => {
        try {
          return d.orchestrator.interface.parseLog(log);
        } catch {
          try {
            return d.feed.interface.parseLog(log);
          } catch {
            return null;
          }
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .map((event) => ({
        name: event.name,
        args: Object.fromEntries(
          event.fragment.inputs.map((input, index) => [
            input.name || String(index),
            String(event.args[index]),
          ]),
        ),
      }));

  console.log(
    JSON.stringify(
      {
        publishLogs: parseLogs(publishReceipt),
        onEventLogs: parseLogs(onEventReceipt),
        onEventGasUsed: onEventReceipt!.gasUsed.toString(),
        mockApiNextReqId: (await d.mockApi!.nextReqId()).toString(),
        taskLock: (await d.orchestrator.taskLock(agentId)).toString(),
        taskState: (await d.orchestrator.tasks(1n)).state.toString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
