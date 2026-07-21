// Drops the Typesense products collection and rebuilds it from Postgres —
// the authoritative fix for a stale/orphaned index (e.g. after deleting
// rows, or docs left behind by older seed generations). Run from repo root:
//   npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/reindex.ts
import { prisma } from "@/lib/db";
import { getTypesense, ensureCollection, upsertProducts } from "@/lib/search/typesense";

async function main() {
  const ts = getTypesense();
  try {
    await ts.collections("products").delete();
  } catch {
    /* collection may not exist */
  }
  await ensureCollection();

  const all = await prisma.product.findMany();
  const voucherMerchants = new Set(
    (await prisma.voucher.findMany({ select: { merchant: true }, distinct: ["merchant"] })).map(
      (v) => v.merchant,
    ),
  );
  await upsertProducts(
    all.map((p) => ({
      id: p.id,
      product: p.id,
      name: p.name,
      merchant: p.merchant,
      category: p.category ?? "",
      price: p.price,
      hasVoucher: voucherMerchants.has(p.merchant),
      salesRank: p.salesRank ?? 0,
      image: p.image ?? "",
    })),
  );
  console.log(`reindexed ${all.length} products`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
