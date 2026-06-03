import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll } from "./helpers";

describe("AgentPolicy", () => {
  async function setupAgent() {
    const d = await deployAll();
    const [, , user] = await ethers.getSigners();
    await d.factory
      .connect(user)
      .deployTwiin("puser", { value: ethers.parseEther("2") });
    return { ...d, user, agentId: 1n };
  }

  it("isKilled returns true after deployTwiin (killSwitch ON by default)", async () => {
    const { policy, agentId } = await setupAgent();
    expect(await policy.isKilled(agentId)).to.be.true;
  });

  it("toggleKillSwitch by NFT owner turns off kill", async () => {
    const { policy, agentId, user } = await setupAgent();
    await policy.connect(user).toggleKillSwitch(agentId, false);
    expect(await policy.isKilled(agentId)).to.be.false;
  });

  it("toggleKillSwitch rejected for non-owner", async () => {
    const { policy, agentId } = await setupAgent();
    const [, , , attacker] = await ethers.getSigners();
    await expect(
      policy.connect(attacker).toggleKillSwitch(agentId, false),
    ).to.be.revertedWith("not owner");
  });

  it("canReserveTaskBudget returns false when kill switch ON", async () => {
    const { policy, agentId } = await setupAgent();
    expect(
      await policy.canReserveTaskBudget(0, agentId, ethers.parseEther("0.5")),
    ).to.be.false;
  });

  it("canReserveTaskBudget returns true after kill off and within caps", async () => {
    const { policy, agentId, user } = await setupAgent();
    await policy.connect(user).toggleKillSwitch(agentId, false);
    expect(
      await policy.canReserveTaskBudget(0, agentId, ethers.parseEther("0.5")),
    ).to.be.true;
  });

  it("canReserveTaskBudget returns false when budget > maxPerTaskWei", async () => {
    const { policy, agentId, user } = await setupAgent();
    await policy.connect(user).toggleKillSwitch(agentId, false);
    // SEED_MAX_PER_TASK = 1 STT; request 2 STT
    expect(
      await policy.canReserveTaskBudget(0, agentId, ethers.parseEther("2")),
    ).to.be.false;
  });

  it("requireAllowed passes for mockRouter and reverts for random", async () => {
    const { policy, agentId, mockRouter, orchestrator } = await setupAgent();
    const orchSigner = await ethers.getImpersonatedSigner(
      await orchestrator.getAddress(),
    );
    await ethers.provider.send("hardhat_setBalance", [
      await orchestrator.getAddress(),
      "0x" + ethers.parseEther("1").toString(16),
    ]);
    // Should not revert for mockRouter
    await policy
      .connect(orchSigner)
      .requireAllowed(agentId, await mockRouter.getAddress());
    // Should revert for random address
    await expect(
      policy.connect(orchSigner).requireAllowed(agentId, ethers.ZeroAddress),
    ).to.be.revertedWith("target not allowed");
  });

  it("validateAndReserveTaskBudget is onlyOrchestrator", async () => {
    const { policy, agentId } = await setupAgent();
    const [, , user] = await ethers.getSigners();
    await expect(
      policy
        .connect(user)
        .validateAndReserveTaskBudget(0, agentId, ethers.parseEther("0.5")),
    ).to.be.revertedWith("only orchestrator");
  });

  it("TrustlessJanice cap is separate from ClaudePlan cap", async () => {
    const { policy, agentId, user } = await setupAgent();
    await policy.connect(user).toggleKillSwitch(agentId, false);
    // PlanMode 0 = ClaudePlan (max 1 STT), PlanMode 1 = TrustlessJanice (max 2 STT)
    expect(
      await policy.canReserveTaskBudget(0, agentId, ethers.parseEther("1.5")),
    ).to.be.false;
    expect(
      await policy.canReserveTaskBudget(1, agentId, ethers.parseEther("1.5")),
    ).to.be.true;
  });
});
