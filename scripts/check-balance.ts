/**
 * Check the agent wallet's USDC balance on Base Sepolia.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... pnpm check-balance
 */

import { createPublicClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// USDC on Base Sepolia — update if the address changes
const USDC_ADDRESS = "0x61fde2eb13d9ed692eda7b403c9ba35b74fd590c";

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
