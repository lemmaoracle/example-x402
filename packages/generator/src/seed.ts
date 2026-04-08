/**
 * Seed script — registers demo blog articles via the generator worker.
 *
 * Usage:
 *   GENERATOR_URL=https://lemma-generator.YOUR.workers.dev pnpm seed
 *
 * Pre-deployed by Lemma for the example-x402 demo.
 */

const GENERATOR_URL = process.env.GENERATOR_URL ?? "http://localhost:8788";

const DEMO_ARTICLES = [
  {
    article: {
      title: "Zero-Knowledge Proofs Explained",
      author: "did:example:alice",
      body: "Zero-knowledge proofs allow one party to prove to another that a statement is true without revealing any information beyond the validity of the statement itself. This fundamental cryptographic primitive has applications ranging from blockchain privacy to authentication systems. In a ZK proof system, the prover generates a proof that satisfies a set of constraints defined by a circuit, and the verifier can check this proof efficiently without learning the underlying data. Modern ZK systems like Groth16 and PLONK have made these proofs practical for real-world applications, with verification times measured in milliseconds even for complex statements.",
      publishedAt: "2026-04-01T00:00:00Z",
      lang: "en",
    },
    subjectId: "did:example:alice",
  },
  {
    article: {
      title: "BBS+ Signatures and Selective Disclosure",
      author: "did:example:bob",
      body: "BBS+ signatures enable a powerful form of privacy-preserving credential verification. Unlike traditional digital signatures where you must reveal the entire signed message, BBS+ allows the holder to selectively disclose specific attributes while keeping others hidden. The issuer signs a vector of messages, and the holder can later create a derived proof that reveals only chosen messages. This is particularly useful for identity systems where a user might need to prove their age without revealing their full date of birth, or prove their nationality without exposing their passport number. The mathematical foundation relies on bilinear pairings over elliptic curves, specifically BLS12-381.",
      publishedAt: "2026-04-05T00:00:00Z",
      lang: "en",
    },
    subjectId: "did:example:bob",
  },
  {
    article: {
      title: "ブロックチェーンとマイクロペイメントの未来",
      author: "did:example:charlie",
      body: "マイクロペイメントは長年にわたりインターネットの課題でした。従来の決済システムでは少額決済のコストが高すぎたためです。しかしブロックチェーン技術、特にレイヤー2ソリューションやMonadのような高速チェーンの登場により、1円以下の決済が現実的になりました。x402プロトコルはHTTPの402ステータスコードを活用し、APIエンドポイントへの支払いをネイティブにサポートします。AIエージェントが自律的にデータを購入する時代において、このような機械間決済の標準化は不可欠です。",
      publishedAt: "2026-04-08T00:00:00Z",
      lang: "ja",
    },
    subjectId: "did:example:charlie",
  },
] as const;

const seed = async (): Promise<void> => {
  console.log(`Seeding ${String(DEMO_ARTICLES.length)} demo articles to ${GENERATOR_URL}...\n`);

  for (const payload of DEMO_ARTICLES) {
    console.log(`  → "${payload.article.title}" by ${payload.article.author}`);

    const response = await fetch(`${GENERATOR_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`    ✗ Failed (${String(response.status)}): ${err}`);
      continue;
    }

    const result = (await response.json()) as {
      docHash: string;
      commitment: string;
      status: string;
    };
    console.log(`    ✓ ${result.status} — docHash: ${result.docHash}`);
  }

  console.log("\nDone.");
};

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
