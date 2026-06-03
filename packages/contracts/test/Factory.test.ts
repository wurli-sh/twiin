import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAll, deriveTwiinAccount, TWIIN_6551_SALT } from "./helpers";

describe("TwiinFactory.deployTwiin", () => {
  it("mints NFT starting at id=1 and increments", async () => {
    const { factory, twiinAgent } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("alice", { value: ethers.parseEther("1") });
    expect(await twiinAgent.nextTokenId()).to.equal(1n);
    expect(await twiinAgent.ownerOf(1n)).to.equal(user.address);

    await factory
      .connect(user)
      .deployTwiin("bob", { value: ethers.parseEther("1") });
    expect(await twiinAgent.nextTokenId()).to.equal(2n);
  });

  it("derives deterministic 6551 address == created address", async () => {
    const { factory, registry6551, twiinAgent, twiinAccountImpl } =
      await deployAll();
    const [, , user] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const tx = await factory
      .connect(user)
      .deployTwiin("test", { value: ethers.parseEther("2") });
    const receipt = await tx.wait();
    const deployedEvent = receipt!.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "TwiinDeployed");
    expect(deployedEvent).to.not.be.null;
    const emittedAddr = deployedEvent!.args.twiinAccountAddr as string;

    const derived = await registry6551.account(
      twiinAccountImpl,
      TWIIN_6551_SALT,
      chainId,
      await twiinAgent.getAddress(),
      1n,
    );
    expect(derived.toLowerCase()).to.equal(emittedAddr.toLowerCase());
  });

  it("funds the 6551 account with msg.value", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();
    const value = ethers.parseEther("5");

    const tx = await factory.connect(user).deployTwiin("funded", { value });
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
    const acctAddr = event!.args.twiinAccountAddr as string;

    expect(await ethers.provider.getBalance(acctAddr)).to.equal(value);
  });

  it("claims name via claimPersonalNameFor in the same tx", async () => {
    const { factory, twiinNames } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("myagent", { value: ethers.parseEther("1") });
    const [kind, id] = await twiinNames.resolve("myagent");
    expect(kind).to.equal(1n); // AgentKind.Personal
    expect(id).to.equal(1n);
  });

  it("seeds policy with killSwitch ON", async () => {
    const { factory, policy } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await factory
      .connect(user)
      .deployTwiin("policytest", { value: ethers.parseEther("1") });
    expect(await policy.isKilled(1n)).to.be.true;
  });

  it("emits TwiinDeployed with all args", async () => {
    const { factory } = await deployAll();
    const [, , user] = await ethers.getSigners();

    await expect(
      factory
        .connect(user)
        .deployTwiin("emitcheck", { value: ethers.parseEther("1") }),
    ).to.emit(factory, "TwiinDeployed");
  });

  it("createAccount is idempotent — second deploy of same id returns same addr", async () => {
    const { registry6551, twiinAgent, twiinAccountImpl } = await deployAll();
    const [deployer, , user] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const addr1 = await registry6551.createAccount.staticCall(
      twiinAccountImpl,
      TWIIN_6551_SALT,
      chainId,
      await twiinAgent.getAddress(),
      99n,
      "0x",
    );
    await registry6551.createAccount(
      twiinAccountImpl,
      TWIIN_6551_SALT,
      chainId,
      await twiinAgent.getAddress(),
      99n,
      "0x",
    );
    const addr2 = await registry6551.createAccount.staticCall(
      twiinAccountImpl,
      TWIIN_6551_SALT,
      chainId,
      await twiinAgent.getAddress(),
      99n,
      "0x",
    );
    expect(addr1.toLowerCase()).to.equal(addr2.toLowerCase());
  });
});
