import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAll,
  deriveTwiinAccount,
  CAP_WEB_SCRAPE_DISCORD,
  signExternalResult,
} from "./helpers";

describe("Multi-actor soak", () => {
  it("repeated keeper-driven refresh cycles complete cleanly across multiple agents", async () => {
    const d = await deployAll({ useMockApi: true });
    const [admin, keeper, userA, userB, userC, operator] = await ethers.getSigners();
    const users = [userA, userB, userC];
    const chainId = (await ethers.provider.getNetwork()).chainId;

    await d.agentRegistry
      .connect(operator)
      .registerExternalAgent(
        "refresh-operator",
        "http://refresh-operator.test",
        ethers.parseEther("0.15"),
        [CAP_WEB_SCRAPE_DISCORD],
        { value: ethers.parseEther("5") },
      );

    const agentIds: bigint[] = [];
    const accounts: string[] = [];
    for (let i = 0; i < users.length; i++) {
      await d.factory
        .connect(users[i])
        .deployTwiin(`soak-${i}`, { value: ethers.parseEther("5") });
      const agentId = BigInt(i + 1);
      agentIds.push(agentId);
      await d.policy.connect(users[i]).toggleKillSwitch(agentId, false);
      const acctAddr = await deriveTwiinAccount(
        d.registry6551,
        d.twiinAccountImpl,
        await d.twiinAgent.getAddress(),
        agentId,
      );
      accounts.push(acctAddr);
      const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
      await acct
        .connect(users[i])
        .subscribePull(await d.orchestrator.getAddress(), ethers.parseEther("0.2"), 1);
    }

    const templateHash = await d.orchestrator.connect(admin).registerTaskTemplate.staticCall(
      [
        {
          subAgentConfigId: 6n,
          payload: ethers.toUtf8Bytes("refresh-step"),
          maxCostWei: ethers.parseEther("0.2"),
          timeoutSeconds: 900,
        },
      ],
      ethers.parseEther("0.2"),
    );
    await d.orchestrator.connect(admin).registerTaskTemplate(
      [
        {
          subAgentConfigId: 6n,
          payload: ethers.toUtf8Bytes("refresh-step"),
          maxCostWei: ethers.parseEther("0.2"),
          timeoutSeconds: 900,
        },
      ],
      ethers.parseEther("0.2"),
    );

    let expectedTaskId = 1n;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < agentIds.length; i++) {
        const refreshTx = await d.orchestrator
          .connect(keeper)
          .refreshFromTemplateByKeeper(agentIds[i], `topic-${i}`, templateHash);
        const refreshReceipt = await refreshTx.wait();
        const requestLog = refreshReceipt!.logs
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
        const sig = await signExternalResult(
          operator,
          await d.orchestrator.getAddress(),
          expectedTaskId,
          0,
          reqId,
          ethers.toUtf8Bytes(`refresh-${round}-${i}`),
          chainId,
        );

        await d.orchestrator.submitExternalResult(
          expectedTaskId,
          0,
          ethers.toUtf8Bytes(`refresh-${round}-${i}`),
          sig,
        );
        await d.orchestrator.connect(keeper).finalizeExternalStep(expectedTaskId, 0, 90);

        const task = await d.orchestrator.tasks(expectedTaskId);
        expect(task.state).to.equal(2n);
        expect(await d.orchestrator.taskLock(agentIds[i])).to.equal(0n);
        expect(await d.vault.taskLockedAmount(expectedTaskId)).to.equal(0n);

        expectedTaskId++;
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine", []);
      }
    }

    for (let i = 0; i < agentIds.length; i++) {
      expect(await d.orchestrator.taskLock(agentIds[i])).to.equal(0n);
      expect(await ethers.provider.getBalance(accounts[i])).to.be.lt(
        ethers.parseEther("5"),
      );
    }
  });
});
