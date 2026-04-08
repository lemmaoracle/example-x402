/**
 * Generate BBS+ key pair for Lemma selective disclosure.
 * 
 * Usage:
 *   pnpm generate-keypair
 * 
 * Output:
 *   - secretKey (hex): Store securely (env var, secret manager, etc.)
 *   - publicKey (hex): Share with Lemma during issuer registration
 */

import { disclose } from "@lemmaoracle/sdk";

async function main() {
  console.log("Generating BBS+ key pair for Lemma selective disclosure...\n");
  
  try {
    const { secretKey, publicKey } = await disclose.generateKeyPair();
    
    const secretKeyHex = Buffer.from(secretKey).toString("hex");
    const publicKeyHex = Buffer.from(publicKey).toString("hex");
    
    console.log("=== IMPORTANT: Save these keys securely ===\n");
    console.log("SECRET KEY (hex):");
    console.log(secretKeyHex);
    console.log("\nPUBLIC KEY (hex):");
    console.log(publicKeyHex);
    console.log("\n=== Usage Instructions ===");
    console.log("1. Store the SECRET KEY as an environment variable (e.g., LEMMA_BBS_SECRET_KEY)");
    console.log("2. Share the PUBLIC KEY with Lemma during issuer registration");
    console.log("3. Never commit the secret key to version control!");
    console.log("\nYou can set the secret key as an environment variable:");
    console.log(`export LEMMA_BBS_SECRET_KEY="${secretKeyHex}"`);
    
    return { secretKeyHex, publicKeyHex };
  } catch (error) {
    console.error("Error generating key pair:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { main };