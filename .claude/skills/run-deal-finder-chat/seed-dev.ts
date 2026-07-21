// Dev seed: fake Shopee catalog into Postgres + Typesense so the whole chat
// loop can be driven without an AccessTrade token. Idempotent.
// Run from repo root:
//   npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/seed-dev.ts
import { prisma } from "@/lib/db";
import { upsertProducts } from "@/lib/search/typesense";

const products = [
  { productId: "sp1", name: "Tai nghe Bluetooth chống ồn Soundcore Q30", price: 890_000, originalPrice: 1_290_000, category: "tai nghe", salesRank: 2 },
  { productId: "sp2", name: "Tai nghe Bluetooth Baseus Bowie M2s chống ồn ANC", price: 650_000, originalPrice: 990_000, category: "tai nghe", salesRank: 8 },
  { productId: "sp3", name: "Tai nghe nhét tai có dây JBL C50HI", price: 190_000, category: "tai nghe", salesRank: null },
  { productId: "sp4", name: "Tai nghe Bluetooth Apple AirPods Pro 2", price: 4_990_000, category: "tai nghe", salesRank: 1 },
  { productId: "sp5", name: "Giày chạy bộ nam Biti's Hunter Core", price: 760_000, originalPrice: 899_000, category: "giày dép", salesRank: 5 },
  { productId: "sp6", name: "Giày thể thao nữ Adidas Duramo SL", price: 1_150_000, category: "giày dép", salesRank: null },
  { productId: "sp7", name: "Nồi chiên không dầu Lock&Lock 5.2L", price: 1_390_000, originalPrice: 2_190_000, category: "gia dụng", salesRank: 3 },
  { productId: "sp8", name: "Son môi Maybelline SuperStay Matte Ink", price: 165_000, originalPrice: 239_000, category: "làm đẹp", salesRank: 4 },
];

async function main() {
  for (const p of products) {
    await prisma.product.upsert({
      where: { merchant_productId: { merchant: "shopee", productId: p.productId } },
      create: {
        productId: p.productId, merchant: "shopee", domain: "shopee.vn",
        name: p.name, price: p.price, originalPrice: p.originalPrice ?? null,
        category: p.category, salesRank: p.salesRank,
        image: `https://picsum.photos/seed/${p.productId}/400`,
        affLink: `https://go.isclix.com/deep_link/demo?url=https%3A%2F%2Fshopee.vn%2Fproduct%2F${p.productId}`,
      },
      update: { price: p.price, salesRank: p.salesRank },
    });
  }
  const voucherCount = await prisma.voucher.count({ where: { merchant: "shopee" } });
  if (voucherCount === 0) {
    await prisma.voucher.createMany({
      data: [
        { merchant: "shopee", domain: "shopee.vn", content: "Giảm 50K đơn từ 500K", code: "SPDEAL50", affLink: "https://go.isclix.com/deep_link/demo-voucher", endTime: new Date(Date.now() + 7 * 86400e3) },
        { merchant: "shopee", domain: "shopee.vn", content: "Freeship Xtra", code: null, affLink: "https://go.isclix.com/deep_link/demo-voucher", endTime: null },
      ],
    });
  }
  const all = await prisma.product.findMany();
  await upsertProducts(all.map((p) => ({
    id: p.id, product: p.id, name: p.name, merchant: p.merchant,
    category: p.category ?? "", price: p.price, hasVoucher: true,
    salesRank: p.salesRank ?? 0, image: p.image ?? "",
  })));
  console.log(`seeded ${all.length} products`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
