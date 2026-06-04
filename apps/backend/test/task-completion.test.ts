import { describe, it, expect, vi } from "vitest";
import { fetchTaskCompletion } from "../src/task-completion";

const validLogData =
  "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000c512c8" as const;

const truncatedLogData =
  "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020" as const;

describe("fetchTaskCompletion", () => {
  it("skips logs without data and uses a later decodable log in the same chunk", async () => {
    const getLogs = vi.fn().mockResolvedValue([
      {
        data: undefined,
        args: { result: "" },
        blockNumber: 1n,
        transactionHash: "0xaaa",
      },
      {
        data: truncatedLogData,
        args: { result: "bad" },
        blockNumber: 2n,
        transactionHash: "0xbbb",
      },
      {
        data: validLogData,
        args: { result: "\u00fd\u0012\u00fd" },
        blockNumber: 3n,
        transactionHash: "0xccc",
      },
    ]);

    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getLogs,
    };

    const result = await fetchTaskCompletion(
      client as never,
      "0x38B724184630aDAA8Bc3e30a247A8901eFb94Ee0",
      2n,
      0n,
    );

    expect(result).toEqual({
      result: "\u00fd\u0012\u00fd",
      decoded: "12915400",
      blockNumber: "3",
      transactionHash: "0xccc",
    });
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  it("returns undecodable fallback when no log decodes in a chunk", async () => {
    const getLogs = vi.fn().mockResolvedValue([
      {
        data: truncatedLogData,
        args: { result: "partial" },
        blockNumber: 9n,
        transactionHash: "0xddd",
      },
    ]);

    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(50n),
      getLogs,
    };

    const result = await fetchTaskCompletion(
      client as never,
      "0x38B724184630aDAA8Bc3e30a247A8901eFb94Ee0",
      2n,
      0n,
    );

    expect(result).toMatchObject({
      result: "partial",
      decoded: null,
      blockNumber: "9",
      transactionHash: "0xddd",
    });
  });
});
