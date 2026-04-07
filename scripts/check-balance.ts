/**
 * Check the agent wallet's USDC balance on Monad testnet.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... pnpm check-balance
 */

import { createPublicClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

// USDC on Monad testnet — update if the address changes
const USDC_ADDRESS = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";

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

const balance = await client.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});

const decimals = await client.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: "decimals",
});

const humanBalance = Number(balance) / Math.pow(10, decimals);

console.log(`Wallet: ${account.address}`);
console.log(`USDC balance (Monad testnet): ${humanBalance.toFixed(6)} USDC`);
