import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll } from "./helpers";

describe("TwiinNames", () => {
  it("valid name is claimed and resolved", async () => {
    const { factory, twiinNames } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("neo", { value: ethers.parseEther("1") });
    const [kind, id] = await twiinNames.resolve("neo");
    expect(kind).to.equal(1n); // Personal
    expect(id).to.equal(1n);
  });

  it("name is case-insensitive (uppercase in resolve normalised)", async () => {
    const { factory, twiinNames } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("neo", { value: ethers.parseEther("1") });
    const [kind] = await twiinNames.resolve("NEO");
    expect(kind).to.equal(1n);
  });

  it("name too short is rejected", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    await expect(
      factory
        .connect(user)
        .deployTwiin("ab", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("name too long is rejected", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    const longName = "a".repeat(33);
    await expect(
      factory
        .connect(user)
        .deployTwiin(longName, { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("name with uppercase chars is rejected (must be lowercase at claim)", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    await expect(
      factory
        .connect(user)
        .deployTwiin("MyAgent", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("reserved prefix 'system-' is rejected", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    await expect(
      factory
        .connect(user)
        .deployTwiin("system-bot", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("reserved prefix 'twiin-' is rejected", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    await expect(
      factory
        .connect(user)
        .deployTwiin("twiin-core", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("reserved prefix 'admin-' is rejected", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    await expect(
      factory
        .connect(user)
        .deployTwiin("admin-ops", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("bad name");
  });

  it("duplicate personal name is rejected", async () => {
    const { factory, twiinAgent } = await deployAll();
    const [, , user, user2] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("unique", { value: ethers.parseEther("1") });
    await expect(
      factory
        .connect(user2)
        .deployTwiin("unique", { value: ethers.parseEther("1") }),
    ).to.be.revertedWith("name taken");
  });

  it("name survives NFT transfer", async () => {
    const { factory, twiinAgent, twiinNames } = await deployAll();
    const [, , user, buyer] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("transfer-me", { value: ethers.parseEther("1") });
    await twiinAgent
      .connect(user)
      .transferFrom(user.address, buyer.address, 1n);

    // Name still resolves to the same id
    const [kind, id] = await twiinNames.resolve("transfer-me");
    expect(kind).to.equal(1n);
    expect(id).to.equal(1n);
    // New owner owns the NFT
    expect(await twiinAgent.ownerOf(1n)).to.equal(buyer.address);
  });

  it("sub-agent name registered via AgentRegistry.registerNative", async () => {
    const { twiinNames } = await deployAll();
    const [kind] = await twiinNames.resolve("janice");
    expect(kind).to.equal(2n); // SubAgent
  });

  it("claimPersonalName directly by NFT owner", async () => {
    const { factory, twiinAgent, twiinNames } = await deployAll();
    const [, , user] = await ethers.getSigners();

    // Deploy without a name
    await factory
      .connect(user)
      .deployTwiin("", { value: ethers.parseEther("1") });
    // Claim name directly
    await twiinNames.connect(user).claimPersonalName(1n, "late-claim");
    const [kind, id] = await twiinNames.resolve("late-claim");
    expect(kind).to.equal(1n);
    expect(id).to.equal(1n);
  });

  it("claimPersonalName rejected for non-owner", async () => {
    const { factory, twiinNames } = await deployAll();
    const [, , user, attacker] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("", { value: ethers.parseEther("1") });
    await expect(
      twiinNames.connect(attacker).claimPersonalName(1n, "steal"),
    ).to.be.revertedWith("not owner");
  });
});
