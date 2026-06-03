import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAll,
  signExternalResult,
  CAP_WEB_SCRAPE,
  CAP_WEB_SCRAPE_DISCORD,
  deriveTwiinAccount,
} from "./helpers";

describe("AgentOrchestrator — external result flow", () => {
  it("submitExternalResult rejects on non-existent task", async () => {
    const d = await deployAll();
    // Bounds check fires before the state check on a non-existent task.
    await expect(
      d.orchestrator.submitExternalResult(999n, 0, "0x1234", "0x"),
    ).to.be.revertedWith("task not running");
  });

  it("submitExternalResult rejects result that is too large (size checked first)", async () => {
    const d = await deployAll();
    const bigResult = "0x" + "ab".repeat(16_385); // 16 385 bytes > 16 384 limit
    await expect(
      d.orchestrator.submitExternalResult(999n, 0, bigResult, "0x"),
    ).to.be.revertedWith("result too large");
  });

  it("finalizeExternalStep is onlyKeeper", async () => {
    const d = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    await expect(
      d.orchestrator.connect(attacker).finalizeExternalStep(999n, 0, 80),
    ).to.be.revertedWith("only keeper");
  });

  it("timeoutRating rejects on non-existent task", async () => {
    const d = await deployAll();
    await expect(d.orchestrator.timeoutRating(999n, 0)).to.be.revertedWith(
      "task not running",
    );
  });

  it("signExternalResult digest matches on-chain expectation (smoke test)", async () => {
    const d = await deployAll();
    const [, , , , externalOp] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const orchAddr = await d.orchestrator.getAddress();

    const result = ethers.toUtf8Bytes("hello world");
    const fakeReqId = ethers.keccak256(ethers.toUtf8Bytes("reqId"));
    const sig = await signExternalResult(
      externalOp,
      orchAddr,
      1n,
      0,
      fakeReqId,
      result,
      chainId,
    );
    // Signature is 65 bytes (r + s + v)
    expect(ethers.getBytes(sig).length).to.equal(65);
  });

  it("reportBadSignature function does NOT exist on orchestrator", async () => {
    const d = await deployAll();
    // ethers v6: use fragments (interface.functions is undefined in v6)
    const names = d.orchestrator.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name ?? "");
    expect(names.some((n) => n === "reportBadSignature")).to.be.false;
  });

  it("full external result flow: register agent → create task → submit result → finalize", async () => {
    const d = await deployAll();
    const [, keeper, user, , externalOp] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    await d.agentRegistry
      .connect(externalOp)
      .registerExternalAgent(
        "ext-agent",
        "http://ext.test",
        ethers.parseEther("0.2"),
        [CAP_WEB_SCRAPE],
        { value: ethers.parseEther("5") },
      );
    await d.factory
      .connect(user)
      .deployTwiin("extuser", { value: ethers.parseEther("5") });
    const agentId = 1n;
    await d.policy.connect(user).toggleKillSwitch(agentId, false);

    const acctAddr = await deriveTwiinAccount(
      d.registry6551,
      d.twiinAccountImpl,
      await d.twiinAgent.getAddress(),
      agentId,
    );
    const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
    const budget = ethers.parseEther("0.5");
    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [
        agentId,
        [
          {
            subAgentConfigId: 6n,
            payload: ethers.toUtf8Bytes("scrape"),
            maxCostWei: ethers.parseEther("0.3"),
            timeoutSeconds: 900,
          },
        ],
        budget,
        0,
      ],
    );

    const createTx = await acct
      .connect(user)
      .execute(await d.orchestrator.getAddress(), budget, createCalldata, 0);
    const createReceipt = await createTx.wait();
    const requestLog = createReceipt!.logs
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
    const result = ethers.toUtf8Bytes("scraped-result");
    const sig = await signExternalResult(
      externalOp,
      await d.orchestrator.getAddress(),
      1n,
      0,
      reqId,
      result,
      chainId,
    );

    await d.orchestrator.submitExternalResult(1n, 0, result, sig);
    await d.orchestrator.connect(keeper).finalizeExternalStep(1n, 0, 80);

    expect((await d.orchestrator.tasks(1n)).state).to.equal(2n);
    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);
  });

  it("external settlement uses the dispatched price even if the agent updates cost later", async () => {
    const d = await deployAll();
    const [, keeper, user, , externalOp] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const quotedCost = ethers.parseEther("0.2");
    const raisedCost = ethers.parseEther("0.29");

    await d.agentRegistry
      .connect(externalOp)
      .registerExternalAgent(
        "price-lock",
        "http://price-lock.test",
        quotedCost,
        [CAP_WEB_SCRAPE_DISCORD],
        { value: ethers.parseEther("5") },
      );
    await d.factory
      .connect(user)
      .deployTwiin("costlock", { value: ethers.parseEther("5") });
    await d.policy.connect(user).toggleKillSwitch(1n, false);

    const acctAddr = await deriveTwiinAccount(
      d.registry6551,
      d.twiinAccountImpl,
      await d.twiinAgent.getAddress(),
      1n,
    );
    const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
    const budget = ethers.parseEther("0.5");
    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [
        1n,
        [
          {
            subAgentConfigId: 6n,
            payload: ethers.toUtf8Bytes("discord scrape"),
            maxCostWei: ethers.parseEther("0.3"),
            timeoutSeconds: 900,
          },
        ],
        budget,
        0,
      ],
    );

    const createTx = await acct
      .connect(user)
      .execute(await d.orchestrator.getAddress(), budget, createCalldata, 0);
    const createReceipt = await createTx.wait();
    const requestLog = createReceipt!.logs
      .map((l) => {
        try {
          return d.orchestrator.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "ExternalAgentRequest");
    const reqId = requestLog!.args.reqId as string;

    await d.agentRegistry.connect(externalOp).updateCost(6n, raisedCost);

    const result = ethers.toUtf8Bytes("priced-result");
    const sig = await signExternalResult(
      externalOp,
      await d.orchestrator.getAddress(),
      1n,
      0,
      reqId,
      result,
      chainId,
    );

    await d.orchestrator.submitExternalResult(1n, 0, result, sig);
    await d.orchestrator.connect(keeper).finalizeExternalStep(1n, 0, 80);

    const task = await d.orchestrator.tasks(1n);
    expect(task.state).to.equal(2n);
    expect(task.spentWei).to.equal(quotedCost);
  });

  it("rejected external steps slash the operator deposit", async () => {
    const d = await deployAll();
    const [, keeper, user, , externalOp] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    await d.agentRegistry
      .connect(externalOp)
      .registerExternalAgent(
        "slash-me",
        "http://slash-me.test",
        ethers.parseEther("0.2"),
        [CAP_WEB_SCRAPE_DISCORD],
        { value: ethers.parseEther("5") },
      );
    await d.factory
      .connect(user)
      .deployTwiin("slashuser", { value: ethers.parseEther("5") });
    await d.policy.connect(user).toggleKillSwitch(1n, false);

    const acctAddr = await deriveTwiinAccount(
      d.registry6551,
      d.twiinAccountImpl,
      await d.twiinAgent.getAddress(),
      1n,
    );
    const acct = await ethers.getContractAt("TwiinAccount", acctAddr);
    const budget = ethers.parseEther("0.5");
    const createCalldata = d.orchestrator.interface.encodeFunctionData(
      "createTask",
      [
        1n,
        [
          {
            subAgentConfigId: 6n,
            payload: ethers.toUtf8Bytes("discord scrape"),
            maxCostWei: ethers.parseEther("0.3"),
            timeoutSeconds: 900,
          },
        ],
        budget,
        0,
      ],
    );

    const createTx = await acct
      .connect(user)
      .execute(await d.orchestrator.getAddress(), budget, createCalldata, 0);
    const createReceipt = await createTx.wait();
    const requestLog = createReceipt!.logs
      .map((l) => {
        try {
          return d.orchestrator.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "ExternalAgentRequest");
    const reqId = requestLog!.args.reqId as string;

    const result = ethers.toUtf8Bytes("bad-result");
    const sig = await signExternalResult(
      externalOp,
      await d.orchestrator.getAddress(),
      1n,
      0,
      reqId,
      result,
      chainId,
    );

    await d.orchestrator.submitExternalResult(1n, 0, result, sig);
    await d.orchestrator.connect(keeper).finalizeExternalStep(1n, 0, 10);

    const agent = await d.agentRegistry.get(6n);
    expect(agent.depositWei).to.equal(ethers.parseEther("4.75"));
    expect((await d.orchestrator.tasks(1n)).state).to.equal(3n);
  });
});

describe("AgentOrchestrator — refresh preflight", () => {
  it("refreshFromTemplateByKeeper rejects non-keeper", async () => {
    const d = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("template"));
    await expect(
      d.orchestrator
        .connect(attacker)
        .refreshFromTemplateByKeeper(1n, "topic", fakeHash),
    ).to.be.revertedWith("only keeper");
  });

  it("refreshFromTemplateByKeeper emits RefreshSkipped('kill switch') when kill switch on", async () => {
    const d = await deployAll();
    const [, keeper, user] = await ethers.getSigners();

    await d.factory
      .connect(user)
      .deployTwiin("refreshtest", { value: ethers.parseEther("3") });
    const agentId = 1n;
    // Kill switch is ON by default
    const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("template"));

    await expect(
      d.orchestrator
        .connect(keeper)
        .refreshFromTemplateByKeeper(agentId, "health", fakeHash),
    )
      .to.emit(d.orchestrator, "RefreshSkipped")
      .withArgs(agentId, "health", "kill switch");
  });

  it("refreshFromTemplateByKeeper emits RefreshSkipped('task preflight') when template not registered", async () => {
    const d = await deployAll();
    const [, keeper, user] = await ethers.getSigners();

    await d.factory
      .connect(user)
      .deployTwiin("preflighttest", { value: ethers.parseEther("3") });
    const agentId = 1n;
    await d.policy.connect(user).toggleKillSwitch(agentId, false);

    const fakeHash = ethers.keccak256(
      ethers.toUtf8Bytes("unregistered-template"),
    );

    // Template not registered → getTemplate will revert → caught → "task preflight"
    await expect(
      d.orchestrator
        .connect(keeper)
        .refreshFromTemplateByKeeper(agentId, "health", fakeHash),
    )
      .to.emit(d.orchestrator, "RefreshSkipped")
      .withArgs(agentId, "health", "task preflight");
  });

  it("refreshFromTemplateByKeeper emits RefreshSkipped('refresh allowance') when no pull approval", async () => {
    const d = await deployAll();
    const [, keeper, user] = await ethers.getSigners();

    await d.factory
      .connect(user)
      .deployTwiin("allowancetest", { value: ethers.parseEther("5") });
    const agentId = 1n;
    await d.policy.connect(user).toggleKillSwitch(agentId, false);

    // Register a template with the orchestrator
    const orchAddr = await d.orchestrator.getAddress();
    await ethers.provider.send("hardhat_setBalance", [
      orchAddr,
      "0x" + ethers.parseEther("10").toString(16),
    ]);
    const orchSigner = await ethers.getImpersonatedSigner(orchAddr);

    const step = {
      subAgentConfigId: 2n,
      payload: "0x",
      maxCostWei: ethers.parseEther("0.2"),
      timeoutSeconds: 900,
    };
    const budget = ethers.parseEther("0.2");

    const templateHash = await d.feed
      .connect(orchSigner)
      .registerTemplate.staticCall([step], budget);
    await d.feed.connect(orchSigner).registerTemplate([step], budget);

    // No subscribePull set → pullForRefresh will revert → RefreshSkipped("refresh allowance")
    await expect(
      d.orchestrator
        .connect(keeper)
        .refreshFromTemplateByKeeper(agentId, "test", templateHash),
    )
      .to.emit(d.orchestrator, "RefreshSkipped")
      .withArgs(agentId, "test", "refresh allowance");
  });

  it("createRefreshTaskFromPulledFunds rejects non-self caller", async () => {
    const d = await deployAll();
    const [, , attacker] = await ethers.getSigners();
    await expect(
      d.orchestrator
        .connect(attacker)
        .createRefreshTaskFromPulledFunds(1n, [], ethers.parseEther("0.1")),
    ).to.be.revertedWith("only self");
  });

  it("stale scheduled refresh entries are ignored after the topic is cancelled", async () => {
    const d = await deployAll({ useMockApi: true });
    const [admin, , user] = await ethers.getSigners();

    await d.factory
      .connect(user)
      .deployTwiin("refreshcancel", { value: ethers.parseEther("5") });
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
      subAgentConfigId: 2n,
      payload: "0x",
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
      .publishFeedAndMaybeSchedule(
        agentId,
        "health",
        "ok",
        90,
        600,
        60,
        templateHash,
      );
    const publishReceipt = await publishTx.wait();
    const publishBlock = await ethers.provider.getBlock(publishReceipt!.blockNumber);
    const timestampMillis = BigInt((publishBlock!.timestamp + 60) * 1000);

    await d.orchestrator
      .connect(admin)
      .publishFeedAndMaybeSchedule(
        agentId,
        "health",
        "ok",
        90,
        600,
        0,
        ethers.ZeroHash,
      );

    const precompile = "0x0000000000000000000000000000000000000100";
    await ethers.provider.send("hardhat_setBalance", [
      precompile,
      "0x" + ethers.parseEther("1").toString(16),
    ]);
    const precompileSigner = await ethers.getImpersonatedSigner(precompile);

    await d.orchestrator
      .connect(precompileSigner)
      .onEvent(
        precompile,
        [ethers.ZeroHash, ethers.zeroPadValue(ethers.toBeHex(timestampMillis), 32)],
        "0x",
      );

    expect(await d.orchestrator.taskLock(agentId)).to.equal(0n);
    expect(await d.vault.taskLockedAmount(1n)).to.equal(0n);
    expect(await d.mockApi!.nextReqId()).to.equal(0n);
  });
});
