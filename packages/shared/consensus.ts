/** On-chain Somnia consensus receipt for a native orchestration step. */
export type StepConsensusReceipt = {
  validators: number;
  finalizedAt: number;
  receiptId: string;
  executionCostWei: string;
};

export type VerificationTier = "corroborated" | "single";
