import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID } from "@twiin/shared";
import { env } from "./env";

const somniaTestnet = defineChain({
  id: CHAIN_ID,
  name: "Somnia Testnet",
  nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [env.SOMNIA_RPC_URL] } },
});

export const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(env.SOMNIA_RPC_URL),
});

export const keeperAccount = privateKeyToAccount(
  env.KEEPER_PRIVATE_KEY as `0x${string}`,
);

export const walletClient = createWalletClient({
  account: keeperAccount,
  chain: somniaTestnet,
  transport: http(env.SOMNIA_RPC_URL),
});
