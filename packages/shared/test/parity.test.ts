import { describe, it, expect } from "vitest";
import {
  encodePacked,
  keccak256,
  toBytes,
  concat,
  encodeAbiParameters,
  getContractAddress,
  parseEther,
  zeroHash,
  recoverMessageAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildTwiinDigest } from "../digest";
import { deriveTwiinAccountAddress } from "../twiin-account";
import {
  CapabilityId,
  CHAIN_ID,
  TWIIN_6551_SALT,
  DEFAULT_MAX_TRUSTLESS_WEI,
  JANICE_ROUND_BUFFER_MULTIPLIER,
  MAX_JANICE_ITERATIONS,
  MIN_TRUSTLESS_BUDGET_MULTIPLIER,
  TaskState,
  StepState,
  AgentLane,
  PlanMode,
  TrustlessAwaiting,
} from "../constants";

// ---------------------------------------------------------------------------
// buildTwiinDigest parity
// ---------------------------------------------------------------------------

describe("buildTwiinDigest", () => {
  const PARAMS = {
    chainId: BigInt(31337),
    orchestrator: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    taskId: 1n,
    stepIdx: 0,
    externalRequestId:
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as `0x${string}`,
    result: "hello world",
  };

  it("matches manual inline computation", () => {
    const resultHash = keccak256(toBytes("hello world"));
    const expected = keccak256(
      encodePacked(
        [
          "string",
          "uint256",
          "address",
          "uint256",
          "uint8",
          "bytes32",
          "bytes32",
        ],
        [
          "\x19Twiin External Result v1\n",
          PARAMS.chainId,
          PARAMS.orchestrator,
          PARAMS.taskId,
          PARAMS.stepIdx,
          PARAMS.externalRequestId,
          resultHash,
        ],
      ),
    );
    expect(buildTwiinDigest(PARAMS)).toBe(expected);
  });

  it("returns a 32-byte hex string", () => {
    const d = buildTwiinDigest(PARAMS);
    expect(d).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(buildTwiinDigest(PARAMS)).toBe(buildTwiinDigest(PARAMS));
  });

  it("changes when result changes", () => {
    const a = buildTwiinDigest({ ...PARAMS, result: "hello world" });
    const b = buildTwiinDigest({ ...PARAMS, result: "different" });
    expect(a).not.toBe(b);
  });

  it("changes when taskId changes", () => {
    const a = buildTwiinDigest({ ...PARAMS, taskId: 1n });
    const b = buildTwiinDigest({ ...PARAMS, taskId: 2n });
    expect(a).not.toBe(b);
  });

  it("accepts Uint8Array result", () => {
    const fromString = buildTwiinDigest({ ...PARAMS, result: "hello world" });
    const fromBytes = buildTwiinDigest({
      ...PARAMS,
      result: toBytes("hello world"),
    });
    expect(fromString).toBe(fromBytes);
  });

  it("accepts hex result", () => {
    const fromHex = buildTwiinDigest({
      ...PARAMS,
      result: "0x68656c6c6f20776f726c64", // utf8 bytes of "hello world"
    });
    const fromBytes = buildTwiinDigest({
      ...PARAMS,
      result: toBytes("hello world"),
    });
    expect(fromHex).toBe(fromBytes);
  });

  it("signature round-trip: sign → recoverMessageAddress", async () => {
    // Use a deterministic test private key
    const pk =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
    const account = privateKeyToAccount(pk);

    const digest = buildTwiinDigest(PARAMS);
    const sig = await account.signMessage({ message: { raw: digest } });

    const recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// deriveTwiinAccountAddress parity
// ---------------------------------------------------------------------------

describe("deriveTwiinAccountAddress", () => {
  // Stable test addresses (checksummed)
  const REGISTRY =
    "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;
  const IMPL = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as `0x${string}`;
  const AGENT = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as `0x${string}`;
  const TOKEN_ID = 1n;
  const CHAIN = BigInt(31337);

  it("matches manual CREATE2 derivation", () => {
    const salt = TWIIN_6551_SALT;
    const footer = encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [salt, CHAIN, AGENT, TOKEN_ID],
    );
    const initCode = concat([
      "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73",
      IMPL,
      "0x5af43d82803e903d91602b57fd5bf3",
      footer,
    ]);
    const expected = getContractAddress({
      opcode: "CREATE2",
      from: REGISTRY,
      salt: salt as `0x${string}`,
      bytecodeHash: keccak256(initCode),
    });

    const result = deriveTwiinAccountAddress({
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      tokenId: TOKEN_ID,
      chainId: CHAIN,
      salt,
    });
    expect(result).toBe(expected);
  });

  it("returns a valid address", () => {
    const addr = deriveTwiinAccountAddress({
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      tokenId: 1n,
      chainId: CHAIN,
    });
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("is deterministic", () => {
    const params = {
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      tokenId: 1n,
      chainId: CHAIN,
    };
    expect(deriveTwiinAccountAddress(params)).toBe(
      deriveTwiinAccountAddress(params),
    );
  });

  it("different tokenIds produce different addresses", () => {
    const base = {
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      chainId: CHAIN,
    };
    expect(deriveTwiinAccountAddress({ ...base, tokenId: 1n })).not.toBe(
      deriveTwiinAccountAddress({ ...base, tokenId: 2n }),
    );
  });

  it("defaults to CHAIN_ID=50312 and TWIIN_6551_SALT=zeroHash", () => {
    const withDefaults = deriveTwiinAccountAddress({
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      tokenId: 1n,
    });
    const explicit = deriveTwiinAccountAddress({
      registry6551: REGISTRY,
      twiinAccountImpl: IMPL,
      twiinAgent: AGENT,
      tokenId: 1n,
      chainId: BigInt(CHAIN_ID),
      salt: TWIIN_6551_SALT,
    });
    expect(withDefaults).toBe(explicit);
  });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe("CapabilityId", () => {
  it("all entries are 32-byte hex strings", () => {
    for (const [key, val] of Object.entries(CapabilityId)) {
      expect(val, key).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("all 9 capability entries are distinct", () => {
    const vals = Object.values(CapabilityId);
    expect(new Set(vals).size).toBe(9);
  });

  it("WEB_SCRAPE matches keccak256 of utf8 'web.scrape'", () => {
    expect(CapabilityId.WEB_SCRAPE).toBe(keccak256(toBytes("web.scrape")));
  });
});

describe("enums match TwiinTypes.sol ordinals", () => {
  it("TaskState", () => {
    expect(TaskState.Created).toBe(0);
    expect(TaskState.Running).toBe(1);
    expect(TaskState.Completed).toBe(2);
    expect(TaskState.Aborted).toBe(3);
  });

  it("StepState", () => {
    expect(StepState.Pending).toBe(0);
    expect(StepState.RunningNative).toBe(1);
    expect(StepState.RunningExternal).toBe(2);
    expect(StepState.AwaitingRating).toBe(3);
    expect(StepState.Succeeded).toBe(4);
    expect(StepState.Failed).toBe(5);
    expect(StepState.Retrying).toBe(6);
    expect(StepState.TimedOut).toBe(7);
  });

  it("AgentLane", () => {
    expect(AgentLane.SomniaNative).toBe(0);
    expect(AgentLane.ExternalHTTP).toBe(1);
  });

  it("PlanMode", () => {
    expect(PlanMode.ClaudePlan).toBe(0);
    expect(PlanMode.TrustlessJanice).toBe(1);
  });

  it("TrustlessAwaiting", () => {
    expect(TrustlessAwaiting.Janice).toBe(0);
    expect(TrustlessAwaiting.Step).toBe(1);
    expect(TrustlessAwaiting.Resume).toBe(2);
    expect(TrustlessAwaiting.Done).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// loadAddresses
// ---------------------------------------------------------------------------

describe("loadAddresses", () => {
  it("rejects stub addresses.json", async () => {
    const { loadAddresses } = await import("../index");
    const stub = {
      _note: "Generated by scripts/deploy.ts — do not edit by hand",
    };
    expect(() => loadAddresses(stub)).toThrow();
  });

  it("accepts a valid addresses object", async () => {
    const { loadAddresses } = await import("../index");
    const addr = "0x" + "ab".repeat(20);
    const valid = {
      chainId: "31337",
      registry6551: addr,
      twiinAgent: addr,
      twiinAccountImpl: addr,
      twiinNames: addr,
      agentRegistry: addr,
      vault: addr,
      policy: addr,
      oracleFeed: addr,
      orchestrator: addr,
      refreshManager: addr,
      factory: addr,
      mUSDC: addr,
      mockRouter: addr,
    };
    const result = loadAddresses(valid);
    expect(result.chainId).toBe("31337");
    expect(result.registry6551).toBe(addr);
  });
});

describe("loadDeploymentManifest", () => {
  it("accepts a valid deployment manifest", async () => {
    const { loadDeploymentManifest } = await import("../index");
    const addr = "0x" + "ab".repeat(20);
    const bytes32 = "0x" + "cd".repeat(32);
    const manifest = {
      _note: "Generated by packages/contracts/scripts/deploy.ts — do not edit by hand",
      network: "hardhat",
      chainId: "31337",
      startBlock: "1",
      deployer: addr,
      keeper: addr,
      agentsApi: addr,
      deployedAt: "2026-06-03T00:00:00.000Z",
      addresses: {
        chainId: "31337",
        registry6551: addr,
        twiinAgent: addr,
        twiinAccountImpl: addr,
        twiinNames: addr,
        agentRegistry: addr,
        vault: addr,
        policy: addr,
        oracleFeed: addr,
        orchestrator: addr,
        refreshManager: addr,
        factory: addr,
        mUSDC: addr,
        mockRouter: addr,
      },
      txHashes: {
        factory: bytes32,
      },
      capabilities: [
        {
          id: bytes32,
          name: "web.scrape",
          minTrustTier: 0,
          nativeOnly: false,
        },
      ],
      nativeAgents: [
        {
          configId: 0,
          name: "janice",
          somniaId: "12847293847561029384",
          costWei: "240000000000000000",
          capabilities: [bytes32],
          trustTier: 2,
        },
      ],
      reservedNames: ["janice"],
    };

    const result = loadDeploymentManifest(manifest);
    expect(result.network).toBe("hardhat");
    expect(result.addresses.factory).toBe(addr);
  });
});

describe("policy defaults", () => {
  it("DEFAULT_MAX_TRUSTLESS_WEI matches TwiinFactory seed", () => {
    expect(DEFAULT_MAX_TRUSTLESS_WEI).toBe(parseEther("2"));
  });

  it("Gate 0 budget multipliers are stable", () => {
    expect(JANICE_ROUND_BUFFER_MULTIPLIER).toBe(3);
    expect(MIN_TRUSTLESS_BUDGET_MULTIPLIER).toBe(2);
  });

  it("MAX_JANICE_ITERATIONS matches contract constant", () => {
    expect(MAX_JANICE_ITERATIONS).toBe(8);
  });
});
