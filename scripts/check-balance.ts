/**
 * Check the agent wallet's USDC balance on Monad Testnet.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... pnpm check-balance
 */

import { createPublicClient, http, erc20Abi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Monad Testnet chain definition
const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

// USDC on Monad Testnet — update if the address changes
const USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!AGENT_PRIVATE_KEY) {
  console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
  process.exit(1);
}

const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
const client = createPublicClient({
  chain: monadTestnet,
  transport: http("https://testnet-rpc.monad.xyz"),
});

async function main() {
  const balance = await client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
    authorizationList: undefined,
  } as any);

  const decimals = await client.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "decimals",
    authorizationList: undefined,
  } as any);

  const humanBalance = Number(balance) / Math.pow(10, decimals);

  console.log(`Wallet: ${account.address}`);
  console.log(`USDC balance (Monad Testnet): ${humanBalance.toFixed(6)} USDC`);
}

main().catch(console.error);
