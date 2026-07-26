// One-time migration: rebuild the `products` collection with the auto-
// embedding field, turning on hybrid (keyword + semantic) search.
//
// Why rebuild instead of ALTER: Typesense 27.1's alter path refuses to load
// the embedding model ("memory required ... exceeds free memory") even when
// plenty is free — its estimate for in-place alters is far more conservative
// than for fresh collections, where the same model loads fine (verified
// 2026-07-26 on this machine). So: drop, recreate via ensureCollection()
// (whose schema now includes EMBEDDING_FIELD), and re-import from Postgres in
// small batches — each import embeds its docs on CPU, so batches keep every
// request short. Search is degraded while this runs (missing collection);
// on this dev setup that's acceptable — expect ~30-60 min for ~50k docs.
//
//   npx tsx --env-file=.env scripts/enable-hybrid-search.ts
//
// Idempotent: exits cleanly if the live collection already has the field.
// If interrupted, re-run — it starts the rebuild over (Postgres is truth).

import { prisma } from "@/lib/db";
import { getTypesense, ensureCollection, EMBEDDING_FIELD, type ProductDoc } from "@/lib/search/typesense";

const COLLECTION = "products";
const BATCH = 200;

async function importBatch(docs: ProductDoc[]): Promise<void> {
  const host = process.env.TYPESENSE_HOST ?? "localhost";
  const port = process.env.TYPESENSE_PORT ?? "8108";
  const protocol = process.env.TYPESENSE_PROTOCOL ?? "http";
  // Raw fetch, no timeout: each batch embeds BATCH names on CPU (seconds to
  // tens of seconds) — beyond the SDK client's timeout.
  const res = await fetch(
    `${protocol}://${host}:${port}/collections/${COLLECTION}/documents/import?action=upsert`,
    {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-typesense-api-key": process.env.TYPESENSE_API_KEY ?? "",
      },
      body: docs.map((d) => JSON.stringify(d)).join("\n"),
    },
  );
  if (!res.ok) throw new Error(`import HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const failures = (await res.text())
    .split("\n")
    .map((l) => JSON.parse(l) as { success: boolean; error?: string })
    .filter((r) => !r.success);
  if (failures.length > 0) {
    throw new Error(`${failures.length}/${docs.length} docs failed: ${failures[0].error}`);
  }
}

async function main() {
  const ts = getTypesense();
  const stamp = () => `[${new Date().toISOString()}]`;

  const existing = await ts.collections(COLLECTION).retrieve().catch(() => null);
  if (existing?.fields?.some((f) => f.name === EMBEDDING_FIELD.name)) {
    console.log("embedding field already present — nothing to do");
    return;
  }

  const total = await prisma.product.count();
  console.log(`${stamp()} rebuilding ${COLLECTION} with ${EMBEDDING_FIELD.embed.model_config.model_name} — ${total} products`);

  if (existing) await ts.collections(COLLECTION).delete();
  await ensureCollection();

  const activeVoucherMerchants = new Set(
    (
      await prisma.voucher.groupBy({
        by: ["merchant"],
        where: { OR: [{ endTime: null }, { endTime: { gte: new Date() } }] },
      })
    ).map((r) => r.merchant),
  );

  const started = Date.now();
  let done = 0;
  for (let skip = 0; skip < total; skip += BATCH) {
    const products = await prisma.product.findMany({
      orderBy: { id: "asc" },
      skip,
      take: BATCH,
    });
    if (products.length === 0) break;
    await importBatch(
      products.map((p) => ({
        id: p.id,
        product: p.id,
        name: p.name,
        merchant: p.merchant,
        category: p.category ?? "",
        price: p.price,
        hasVoucher: activeVoucherMerchants.has(p.merchant),
        salesRank: p.salesRank ?? 0,
        image: p.image ?? "",
      })),
    );
    done += products.length;
    if (done % 2000 < BATCH) {
      const rate = done / ((Date.now() - started) / 60000);
      console.log(`${stamp()} ${done}/${total} embedded (${Math.round(rate)}/min, ~${Math.round((total - done) / rate)} min left)`);
    }
  }
  console.log(`${stamp()} done: ${done} docs in ${Math.round((Date.now() - started) / 60000)} min`);
}

main()
  .catch((err) => {
    console.error("enable-hybrid-search failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
