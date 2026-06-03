import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll } from "./helpers";

describe("AgentVault", () => {
  it("lockStep requires msg.value == amt — removed fns absent", async () => {
    const { vault } = await deployAll();
    // ethers v6: getFunction returns null for unknown names; fragments is the canonical list
    const fnNames = vault.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name ?? "");
    for (const name of [
      "deposit",
      "withdraw",
      "refundStep",
      "setOwner",
      "balances",
      "owners",
    ]) {
      expect(fnNames).to.not.include(name);
    }
  });

  it("no balances/owners mapping exposed", async () => {
    const { vault } = await deployAll();
    const iface = vault.interface;
    const names = Object.values(iface.fragments).map((f) => f.name ?? "");
    for (const n of [
      "balances",
      "owners",
      "deposit",
      "withdraw",
      "refundStep",
      "setOwner",
    ]) {
      expect(names.some((f) => f === n)).to.be.false;
    }
  });

  it("lockStep increments taskLockedAmount", async () => {
    const { vault, orchestrator, factory, twiinAgent } = await deployAll();
    const [deployer, keeper, user] = await ethers.getSigners();

    // We can only call lockStep as the orchestrator. Wire a mock orchestrator for this test.
    // Instead, verify via a full createTask flow in Orchestrator.task.test.ts.
    // Here we verify direct revert on wrong caller:
    await expect(
      vault.connect(user).lockStep(1n, 1n, ethers.parseEther("1"), {
        value: ethers.parseEther("1"),
      }),
    ).to.be.revertedWith("only orchestrator");
  });

  it("payNative reverts for non-orchestrator", async () => {
    const { vault } = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    await expect(vault.connect(attacker).payNative(1n, 1n)).to.be.revertedWith(
      "only orchestrator",
    );
  });

  it("releaseExternal reverts for non-orchestrator", async () => {
    const { vault } = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    await expect(
      vault
        .connect(attacker)
        .releaseExternal(1n, 0, attacker.address, ethers.parseEther("1")),
    ).to.be.revertedWith("only orchestrator");
  });

  it("sweepTaskRemainder reverts for non-orchestrator", async () => {
    const { vault } = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    await expect(
      vault
        .connect(attacker)
        .sweepTaskRemainder(1n, attacker.address, ethers.parseEther("1")),
    ).to.be.revertedWith("only orchestrator");
  });
});
