// Removes the fake catalog created by seed-dev.ts (products sp1–sp8 and the
// demo vouchers) from Postgres AND the Typesense index, so only real
// AccessTrade data remains. Idempotent. Run from repo root:
//   npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/unseed-dev.ts
import { prisma } from "@/lib/db";
import { getTypesense } from "@/lib/search/typesense";

const SEED_IDS = ["sp1", "sp2", "sp3", "sp4", "sp5", "sp6", "sp7", "sp8"];

async function main() {
  const seeded = await prisma.product.findMany({
    where: { merchant: "shopee", productId: { in: SEED_IDS } },
    select: { id: true },
  });

  const ts = getTypesense();
  for (const p of seeded) {
    try {
      await ts.collections("products").documents(p.id).delete();
    } catch {
      /* not in the index — fine */
    }
  }

  const products = await prisma.product.deleteMany({
    where: { merchant: "shopee", productId: { in: SEED_IDS } },
  });
  const vouchers = await prisma.voucher.deleteMany({
    where: { affLink: { contains: "deep_link/demo" } },
  });
  console.log(`removed ${products.count} demo products, ${vouchers.count} demo vouchers`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
