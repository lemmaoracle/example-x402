/**
 * Example script for registering blog articles with full content support.
 * 
 * This extends the original registration flow to include full HTML/Markdown content
 * for AI agents to access after payment.
 */

import { config } from "dotenv";
import { schemas, define, prepare, disclose, documents, proofs } from "@lemmaoracle/sdk";
config();

const client = { 
  apiBase: process.env.LEMMA_API_BASE || "https://workers.lemma.workers.dev",
  apiKey: process.env.LEMMA_API_KEY,
};

async function registerArticleWithFullContent(article: {
  title: string;
  author: string;
  body: string;
  publishedAt: string;
  lang: string;
  fullContent: string;
  contentType: "html" | "markdown" | "plain";
}) {
  console.log(`Registering article: ${article.title}`);
  
  // Fetch the deployed schema
  const schemaMeta = await schemas.getById(client, "blog-article-v1");
  const schema = await define(schemaMeta);
  
  // Prepare with full content
  const prep = await prepare(client, {
    schema: schema.id,
    payload: {
      title: article.title,
      author: article.author,
      body: article.body,
      publishedAt: article.publishedAt,
      lang: article.lang,
      fullContent: article.fullContent,
      contentType: article.contentType,
    },
  });
  
  console.log("Normalized attributes:", prep.normalized);
  
  // For BBS+ selective disclosure, include all attributes
  const normalized = prep.normalized as Record<string, unknown>;
  const payload = {
    author: normalized.author as string,
    body: article.body,
    integrity: normalized.integrity as string,
    lang: normalized.lang as string,
    published: String(normalized.published),
    title: article.title,
    words: String(normalized.words),
    fullContent: article.fullContent, // Full content for AI access
  };
  
  const secretKey = process.env.LEMMA_BBS_SECRET_KEY;
  if (!secretKey) {
    throw new Error("LEMMA_BBS_SECRET_KEY environment variable is required");
  }
  
  const messages = disclose.payloadToMessages(payload);
  const signed = await disclose.sign(client, {
    messages,
    secretKey: Buffer.from(secretKey, 'hex'),
    header: new TextEncoder().encode("blog-article-v1"),
    issuerId: article.author,
  });
  
  // Free tier: reveal only basic attributes
  const freeIndexes = [0, 4, 5]; // author, published, title
  const freeDisclosure = await disclose.reveal(client, {
    signature: signed.signature,
    messages: signed.messages,
    publicKey: signed.publicKey,
    indexes: freeIndexes,
    header: new TextEncoder().encode("blog-article-v1"),
  });
  
  // Paid tier: reveal body and full content
  const paidIndexes = [1, 7]; // body, fullContent
  const paidDisclosure = await disclose.reveal(client, {
    signature: signed.signature,
    messages: signed.messages,
    publicKey: signed.publicKey,
    indexes: [...freeIndexes, ...paidIndexes], // All attributes
    header: new TextEncoder().encode("blog-article-v1"),
  });
  
const docHash = `0x${normalized.integrity as string}`;

  // Register the document
  await documents.register(client, {
    schema: schema.id,
    docHash,
    cid: `cid://${docHash.slice(2)}`, // Generate a simple CID from docHash
    issuerId: article.author,
    subjectId: article.author,
    attributes: normalized,
    commitments: {
      scheme: "poseidon",
      root: prep.commitments.root,
      leaves: prep.commitments.leaves,
      randomness: prep.commitments.randomness,
    },
    revocation: {
      type: "none" as const,
      root: "",
    },
  });

  // Submit proof with selective disclosure for paid tier
  // condition: x402-payment-v1 requires on-chain payment proof to disclose
  // Without proof: only basic attributes are visible
  // With proof: body and fullContent are disclosed
  await proofs.submit(client, {
    docHash,
    circuitId: "blog-article-v1",
    proof: "", // Placeholder for production
    inputs: [
      normalized.author as string,
      normalized.body as string,
      normalized.integrity as string,
      String(normalized.words),
      normalized.lang as string,
      normalized.title as string,
      String(normalized.published),
      normalized.fullContent as string,
    ],
    disclosure: disclose.toSelectiveDisclosure(paidDisclosure, {
      publicKey: signed.publicKey,
      header: new TextEncoder().encode("blog-article-v1"),
      count: messages.length,
      condition: { circuitId: "x402-payment-v1" },
    }),
  });
  
  console.log(`✅ Article registered with docHash: ${docHash}`);
  console.log(`Free tier: title, author, date`);
  console.log(`Paid tier: + body (${article.body.length} chars) and full content (${article.fullContent.length} chars) — requires x402 payment proof`);
  
  return {
    docHash,
    freeDisclosure,
    paidDisclosure,
  };
}

// Example usage
const exampleArticle = {
  title: "The Future of AI and Blockchain",
  author: "did:example:alice",
  body: "Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation. This convergence enables verifiable provenance and transparent content attribution.",
  publishedAt: "2026-04-08T14:30:00Z",
  lang: "en",
  fullContent: `
<!DOCTYPE html>
<html>
<head>
  <title>The Future of AI and Blockchain</title>
  <meta name="author" content="Alice">
</head>
<body>
  <article>
    <h1>The Future of AI and Blockchain</h1>
    <p class="author">By Alice · April 8, 2026</p>
    
    <p>Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation.</p>
    
    <h2>Trust in the Age of AI</h2>
    <p>As AI agents become more prevalent on the web, establishing trust becomes critical. Traditional methods like watermarking are fragile and can be removed with simple paraphrasing.</p>
    
    <h2>ZK Proofs for Provenance</h2>
    <p>Zero-knowledge proofs offer a mathematical guarantee of content provenance. With Lemma's selective disclosure, AI agents can verify authorship and publication date without accessing the full content.</p>
    
    <h2>Micropayments for Access</h2>
    <p>The x402 protocol enables AI agents to pay micro-fees for access to verified content. This creates sustainable monetization for content creators while maintaining free access for human readers.</p>
    
    <div class="ai-note">
      <strong>Note for AI agents:</strong> This content is ZK-verified. Basic metadata is freely verifiable. Full content requires a micropayment of $0.001 USDC.
    </div>
  </article>
</body>
</html>
  `.trim(),
  contentType: "html" as const,
};

// Run
registerArticleWithFullContent(exampleArticle).catch(console.error);