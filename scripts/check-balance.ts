/**
 * Check the agent wallet's USDC balance on Base Sepolia.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... pnpm check-balance
 */

import { createPublicClient, http, erc20Abi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Base Sepolia chain definition
const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
  testnet: true,
});

// USDC on Base Sepolia — update if the address changes
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!AGENT_PRIVATE_KEY) {
  console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
  process.exit(1);
}

const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
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
  console.log(`USDC balance (Base Sepolia): ${humanBalance.toFixed(6)} USDC`);
}

main().catch(console.error);
