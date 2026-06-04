import { ethers } from "hardhat";
import {
  CAP_WEB_SCRAPE,
  deployAll,
  deriveTwiinAccount,
  signExternalResult,
} from "../test/helpers";

async function main() {
  const d = await deployAll();
  const [, , user, , externalOp] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  await d.agentRegistry
    .connect(externalOp)
    .registerExternalAgent(
      "gas-probe",
      "http://gas-probe.test",
      ethers.parseEther("0.2"),
      [CAP_WEB_SCRAPE],
      { value: ethers.parseEther("5") },
    );

  await d.factory.connect(user).deployTwiin("gas-user", {
    value: ethers.parseEther("5"),
  });
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
    .map((log) => {
      try {
        return d.orchestrator.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "ExternalAgentRequest");

  if (!requestLog) {
    throw new Error("missing ExternalAgentRequest");
  }

  const reqId = requestLog.args.reqId as string;
  const result = ethers.toUtf8Bytes("scraped-result");
  const signature = await signExternalResult(
    externalOp,
    await d.orchestrator.getAddress(),
    1n,
    0,
    reqId,
    result,
    chainId,
  );

  const estimatedGas = await d.orchestrator.submitExternalResult.estimateGas(
    1n,
    0,
    result,
    signature,
  );
  const tx = await d.orchestrator.submitExternalResult(1n, 0, result, signature);
  const receipt = await tx.wait();

  console.log(
    JSON.stringify(
      {
        estimatedGas: estimatedGas.toString(),
        gasUsed: receipt!.gasUsed.toString(),
        txHash: receipt!.hash,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
