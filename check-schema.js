import { create, schemas } from "@lemmaoracle/sdk";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "lemma");

dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const LEMMA_API_KEY = process.env.LEMMA_API_KEY;

async function main() {
  if (!LEMMA_API_KEY) {
    console.error("LEMMA_API_KEY not found");
    process.exit(1);
  }

  const client = create({
    apiBase: "https://workers.lemma.workers.dev",
    apiKey: LEMMA_API_KEY,
  });

  try {
    console.log("Fetching schema: agent-identity-authority-v1");
    const schema = await schemas.getById(client, "agent-identity-authority-v1");
    console.log("✅ Schema found");
    console.log("ID:", schema.id);
    console.log("Description:", schema.description);
    console.log("Has artifact:", !!schema.normalize?.artifact);
  } catch (error) {
    if (error.message?.includes("404") || error.message?.includes("not found")) {
      console.log("❌ Schema not found");
    } else {
      console.error("Error:", error.message);
    }
  }

  try {
    console.log("\nFetching schema: passthrough-v1");
    const schema = await schemas.getById(client, "passthrough-v1");
    console.log("✅ Schema found");
    console.log("ID:", schema.id);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main().catch(console.error);