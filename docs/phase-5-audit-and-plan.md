# Consensus Receipts

Consensus receipts (`StepConsensusReached`) are emitted on every native Somnia agent step via the `handleResponse` path. This was ported from the tsugu `AgentCompute` pattern — a subcommittee of 3 validators each produce a receipt; the median cost is used for step payment.

The Claude Haiku planner is the sole default planning path for all tasks.
