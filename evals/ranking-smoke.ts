// Ranking smoke eval (D4): ~25 hand-labeled VN scenarios asserting the
// composite score orders candidates sanely with the default weights. This
// catches gross regressions in rank(); it is NOT weight tuning.
// Run: npm run eval:ranking  (pure — no DB/Typesense/API needed)

import { rank, type Candidate } from "../lib/affiliate/ranking";

let passed = 0;
const failures: string[] = [];

function c(partial: Partial<Candidate> & { id: string; price: number }): Candidate {
  return {
    name: partial.name ?? partial.id,
    merchant: "shopee",
    domain: "shopee.vn",
    vouchers: [],
    ...partial,
  } as Candidate;
}

function vouchers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `v${i}`, content: `Giảm ${(i + 1) * 10}K` }));
}

/** Assert the expected id ranks first among the candidates. */
function expectTop(label: string, candidates: Candidate[], expectedTopId: string) {
  const ranked = rank(candidates);
  if (ranked[0]?.id === expectedTopId) passed++;
  else
    failures.push(
      `${label}: expected "${expectedTopId}" first, got "${ranked[0]?.id}" (scores: ${ranked
        .map((r) => `${r.id}=${r.score.toFixed(3)}`)
        .join(", ")})`,
    );
}

/** Assert id A ranks above id B. */
function expectAbove(label: string, candidates: Candidate[], a: string, b: string) {
  const ranked = rank(candidates);
  const ia = ranked.findIndex((r) => r.id === a);
  const ib = ranked.findIndex((r) => r.id === b);
  if (ia >= 0 && ib >= 0 && ia < ib) passed++;
  else failures.push(`${label}: expected "${a}" above "${b}"`);
}

// ── Price dominance ─────────────────────────────────────────────────────────
expectTop("tai nghe bluetooth dưới 1 triệu — rẻ hơn thắng khi mọi thứ khác bằng nhau", [
  c({ id: "tn-re", price: 450_000 }),
  c({ id: "tn-dat", price: 950_000 }),
], "tn-re");

expectTop("giày chạy bộ 800k — giá thấp nhất đứng đầu", [
  c({ id: "giay-a", price: 790_000 }),
  c({ id: "giay-b", price: 650_000 }),
  c({ id: "giay-c", price: 720_000 }),
], "giay-b");

expectTop("nồi chiên không dầu — 3 mức giá", [
  c({ id: "noi-1", price: 1_200_000 }),
  c({ id: "noi-2", price: 890_000 }),
  c({ id: "noi-3", price: 1_500_000 }),
], "noi-2");

// ── Vouchers can beat a small price gap ─────────────────────────────────────
// Note: with only 2 candidates, min-max normalization stretches any price gap
// to the full 0–1 range — so these sets include a high-priced decoy to keep a
// small nominal gap small, matching real result sets of 3–8 items.
expectTop("son môi — 3 voucher thắng chênh giá nhỏ (trong set có hàng đắt)", [
  c({ id: "son-voucher", price: 190_000, vouchers: vouchers(3) }),
  c({ id: "son-re", price: 165_000 }),
  c({ id: "son-dat", price: 420_000 }),
], "son-voucher");

expectTop("sạc dự phòng — nhiều voucher bù giá nhỉnh hơn chút", [
  c({ id: "sac-v", price: 310_000, vouchers: vouchers(4) }),
  c({ id: "sac-0", price: 290_000 }),
  c({ id: "sac-dat", price: 650_000 }),
], "sac-v");

// ── ...but not a large price gap ────────────────────────────────────────────
expectTop("áo thun — rẻ hơn hẳn thắng dù không voucher", [
  c({ id: "ao-re", price: 90_000 }),
  c({ id: "ao-voucher", price: 350_000, vouchers: vouchers(5) }),
], "ao-re");

expectTop("bàn phím cơ — giá gấp đôi không cứu nổi bằng voucher", [
  c({ id: "bp-re", price: 600_000, vouchers: vouchers(1) }),
  c({ id: "bp-dat", price: 1_400_000, vouchers: vouchers(6) }),
], "bp-re");

// ── Voucher saturation: 6 vs 3 vouchers ≪ 3 vs 0 ───────────────────────────
{
  const base = [
    c({ id: "s0", price: 500_000, vouchers: vouchers(0) }),
    c({ id: "s3", price: 500_000, vouchers: vouchers(3) }),
    c({ id: "s6", price: 500_000, vouchers: vouchers(6) }),
  ];
  const ranked = rank(base);
  const gap03 = ranked.find((r) => r.id === "s3")!.voucherScore - ranked.find((r) => r.id === "s0")!.voucherScore;
  const gap36 = ranked.find((r) => r.id === "s6")!.voucherScore - ranked.find((r) => r.id === "s3")!.voucherScore;
  if (gap03 > gap36 * 2) passed++;
  else failures.push(`voucher saturation: gap(0→3)=${gap03.toFixed(3)} should dwarf gap(3→6)=${gap36.toFixed(3)}`);
}

// ── Quality proxy (salesRank) as tiebreaker ─────────────────────────────────
expectTop("máy xay sinh tố — cùng giá, hàng bán chạy thắng", [
  c({ id: "mx-thuong", price: 550_000 }),
  c({ id: "mx-banchay", price: 550_000, salesRank: 1 }),
], "mx-banchay");

expectAbove("ốp lưng iphone — rank 2 trên rank 40", [
  c({ id: "op-hot", price: 50_000, salesRank: 2 }),
  c({ id: "op-thuong", price: 50_000, salesRank: 40 }),
  c({ id: "op-khac", price: 55_000 }),
], "op-hot", "op-thuong");

expectTop("quality không thắng nổi giá rẻ hơn nhiều", [
  c({ id: "q-re", price: 200_000 }),
  c({ id: "q-hot", price: 900_000, salesRank: 1 }),
], "q-re");

// ── Mixed realistic sets ────────────────────────────────────────────────────
expectTop("tai nghe chống ồn — rẻ + voucher + bán chạy là quán quân", [
  c({ id: "tn-full", price: 690_000, vouchers: vouchers(2), salesRank: 3 }),
  c({ id: "tn-dathon", price: 990_000, vouchers: vouchers(1) }),
  c({ id: "tn-khongvoucher", price: 750_000 }),
], "tn-full");

expectAbove("robot hút bụi — voucher + quality kéo lên trên máy đắt trơn", [
  c({ id: "rb-a", price: 4_500_000, vouchers: vouchers(2), salesRank: 5 }),
  c({ id: "rb-b", price: 4_700_000 }),
  c({ id: "rb-c", price: 3_900_000 }),
], "rb-a", "rb-b");

expectTop("bình giữ nhiệt — bộ 4 ứng viên", [
  c({ id: "bgn-1", price: 150_000, vouchers: vouchers(1) }),
  c({ id: "bgn-2", price: 220_000, vouchers: vouchers(2) }),
  c({ id: "bgn-3", price: 145_000 }),
  c({ id: "bgn-4", price: 300_000, salesRank: 1 }),
], "bgn-1");

expectAbove("kem chống nắng — bán chạy trên không-bán-chạy cùng giá", [
  c({ id: "kcn-hot", price: 180_000, salesRank: 10 }),
  c({ id: "kcn-thuong", price: 180_000 }),
  c({ id: "kcn-re", price: 120_000 }),
], "kcn-hot", "kcn-thuong");

expectTop("kem chống nắng — nhưng rẻ nhất vẫn đứng đầu", [
  c({ id: "kcn-hot", price: 180_000, salesRank: 10 }),
  c({ id: "kcn-thuong", price: 180_000 }),
  c({ id: "kcn-re", price: 120_000 }),
], "kcn-re");

// ── Edge cases ──────────────────────────────────────────────────────────────
{
  const ranked = rank([]);
  if (ranked.length === 0) passed++;
  else failures.push("empty input should return empty");
}

{
  const single = rank([c({ id: "solo", price: 100_000 })]);
  if (single.length === 1 && Number.isFinite(single[0].score)) passed++;
  else failures.push("single candidate must get a finite score");
}

{
  // All same price → priceScore neutral, voucher decides.
  expectTop("đồng giá — voucher quyết định", [
    c({ id: "dg-0", price: 99_000 }),
    c({ id: "dg-v", price: 99_000, vouchers: vouchers(2) }),
  ], "dg-v");
}

expectTop("balo laptop — strikethrough không ảnh hưởng, so theo giá bán", [
  c({ id: "balo-sale", price: 250_000, originalPrice: 500_000 }),
  c({ id: "balo-thuong", price: 320_000 }),
], "balo-sale");

expectAbove("chuột gaming — voucher hạng giữa trên hàng trơn đắt", [
  c({ id: "ch-a", price: 450_000, vouchers: vouchers(3) }),
  c({ id: "ch-b", price: 520_000 }),
  c({ id: "ch-c", price: 380_000 }),
], "ch-a", "ch-b");

expectTop("máy lọc không khí — tổng hòa 5 ứng viên", [
  c({ id: "ml-1", price: 2_900_000, vouchers: vouchers(1), salesRank: 8 }),
  c({ id: "ml-2", price: 2_400_000, vouchers: vouchers(3), salesRank: 2 }),
  c({ id: "ml-3", price: 3_500_000 }),
  c({ id: "ml-4", price: 2_600_000 }),
  c({ id: "ml-5", price: 4_100_000, vouchers: vouchers(5) }),
], "ml-2");

expectAbove("tã em bé — voucher nhiều hơn thắng cùng giá cùng rank", [
  c({ id: "ta-a", price: 330_000, vouchers: vouchers(4), salesRank: 6 }),
  c({ id: "ta-b", price: 330_000, vouchers: vouchers(1), salesRank: 6 }),
], "ta-a", "ta-b");

expectAbove("nước hoa — mọi thứ bằng, salesRank tốt hơn thắng", [
  c({ id: "nh-a", price: 750_000, vouchers: vouchers(2), salesRank: 3 }),
  c({ id: "nh-b", price: 750_000, vouchers: vouchers(2), salesRank: 30 }),
], "nh-a", "nh-b");

expectTop("màn hình 24 inch — rẻ nhất + có voucher là không thể cãi", [
  c({ id: "mh-win", price: 2_100_000, vouchers: vouchers(2) }),
  c({ id: "mh-2", price: 2_500_000, vouchers: vouchers(2) }),
  c({ id: "mh-3", price: 2_900_000, salesRank: 1 }),
], "mh-win");

// ── Report ──────────────────────────────────────────────────────────────────
const total = passed + failures.length;
console.log(`ranking-smoke: ${passed}/${total} passed`);
for (const f of failures) console.error(`  FAIL ${f}`);
if (failures.length > 0) process.exit(1);
