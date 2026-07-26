// Ingestion jobs: AccessTrade → Postgres → Typesense. Orchestrated by n8n via
// /api/internal/ingest/[job]; ALL logic lives here (invariant 6), the workflow
// GUI only schedules. Throttling + rate-limit retry live in the adapter.
//
// D2: the index is gated to APPROVED campaigns only.
// D3: nightly full refresh comes from the static CSV datafeed (bulk — avoids
//     the 30/min ceiling); vouchers are pulled via API every 6h.
// ASSUMPTION: the CSV export (ACCESSTRADE_CSV_URL) has a header row with the
// same field names as /v1/datafeeds (product_id, merchant, domain, name,
// price, original_price, image, category, aff_link). Adjust parseCsv mapping
// if the actual export differs.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getAccessTrade, type AtDatafeedItem } from "@/lib/affiliate/accesstrade";
import { upsertProducts, type ProductDoc } from "@/lib/search/typesense";

const PAGE_LIMIT = 100;
const MAX_API_PAGES = 150; // safety bound for API-paged pulls (Shopee datafeed is ~12.9k rows ≈ 129 pages)

export interface IngestResult {
  job: string;
  processed: number;
  skippedUnapproved: number;
}

/**
 * Merchants whose campaign this publisher is approved for (D2).
 * VERIFIED against the live API: the field is `approval` and the approved
 * value is "successful" (other values seen: "unregistered", "pending").
 * An empty result means nothing gets indexed, so we fail loud rather than
 * silently ingesting zero rows.
 */
export const APPROVED_STATUS = "successful";

async function approvedMerchants(): Promise<Set<string>> {
  const campaigns = await getAccessTrade().campaigns();
  const approved = new Set(
    campaigns
      .filter((c) => c.approval === APPROVED_STATUS)
      .map((c) => c.merchant.toLowerCase()),
  );
  if (approved.size === 0) {
    throw new Error(
      `No approved campaigns found (checked ${campaigns.length}). ` +
        `Verify approvals at pub.accesstrade.vn/accounts, or that the API still ` +
        `reports approval="${APPROVED_STATUS}".`,
    );
  }
  return approved;
}

/** Merchants that currently have ≥1 active (non-expired) voucher. */
async function merchantsWithActiveVouchers(): Promise<Set<string>> {
  const rows = await prisma.voucher.groupBy({
    by: ["merchant"],
    where: { OR: [{ endTime: null }, { endTime: { gte: new Date() } }] },
  });
  return new Set(rows.map((r) => r.merchant));
}

/**
 * Normalize a live datafeed row to our Product shape.
 *
 * originalPrice is deliberately left NULL. The Shopee feed has no
 * original/list-price field: `discount` is a tiny value (6–33₫ on items priced
 * 100k–445k, present on <10% of rows) and `discount_amount` is just
 * `price - discount`, so neither reconstructs a pre-discount price. Inventing
 * one would render a false strikethrough — an unverifiable price claim, which
 * is exactly the exposure R3 warns about. Backfill this only if a feed with a
 * genuine list price is added.
 *
 * `cate` is the category slug and is usually an empty string in this feed.
 */
function toProductFields(item: AtDatafeedItem) {
  return {
    name: item.name,
    price: Math.round(item.price),
    originalPrice: null,
    image: item.image || null,
    category: item.cate || null,
    affLink: item.aff_link,
    domain: item.domain,
  };
}

/**
 * Upsert product rows into Postgres, then sync Typesense. Batched raw SQL
 * (one INSERT … ON CONFLICT per 500 rows) — the per-row Prisma upsert cost
 * ~80ms×n against remote Postgres (Neon), turning a nightly into hours.
 * COALESCE on category: the feed's `cate` is usually empty, and blindly
 * overwriting would wipe the LLM-assigned categories every night.
 */
async function upsertAndIndex(items: AtDatafeedItem[]): Promise<number> {
  const docs: ProductDoc[] = [];
  const voucherMerchants = await merchantsWithActiveVouchers();
  // Postgres Product.price is INT4; rows above ~2.1B VND (seen live on
  // dienmayxanh.com: 2,944,480,000) overflow it. No consumer deal costs that
  // much — skip rather than crash the whole job.
  const MAX_PRICE_VND = 2_000_000_000;
  // Dedupe by natural key — a repeated row within one statement would trip
  // "ON CONFLICT cannot affect row a second time".
  const byKey = new Map<string, AtDatafeedItem>();
  for (const item of items) {
    if (!item.product_id || !item.aff_link || !Number.isFinite(item.price)) continue;
    if (item.price <= 0 || item.price > MAX_PRICE_VND) continue;
    byKey.set(`${item.merchant}:${item.product_id}`, item);
  }
  const valid = [...byKey.values()];

  const BATCH = 500;
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = chunk.map((item, j) => {
      const f = toProductFields(item);
      params.push(
        randomUUID(), // only used for new rows; conflicts keep their id
        item.product_id,
        item.merchant,
        f.domain,
        f.name,
        f.price,
        f.originalPrice,
        f.image,
        f.category,
        f.affLink,
      );
      const b = j * 10;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},now())`;
    });
    const rows = await prisma.$queryRawUnsafe<
      { id: string; merchant: string; name: string; category: string | null; price: number; salesRank: number | null; image: string | null }[]
    >(
      `INSERT INTO "Product" (id, "productId", merchant, domain, name, price, "originalPrice", image, category, "affLink", "updatedAt")
       VALUES ${tuples.join(",")}
       ON CONFLICT (merchant, "productId") DO UPDATE SET
         name = EXCLUDED.name,
         price = EXCLUDED.price,
         "originalPrice" = EXCLUDED."originalPrice",
         image = EXCLUDED.image,
         category = COALESCE(EXCLUDED.category, "Product".category),
         "affLink" = EXCLUDED."affLink",
         domain = EXCLUDED.domain,
         "updatedAt" = now()
       RETURNING id, merchant, name, category, price, "salesRank", image`,
      ...params,
    );
    docs.push(
      ...rows.map((p) => ({
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
  }
  await upsertProducts(docs);
  return docs.length;
}

/** Minimal CSV parser (handles quoted fields with commas/escaped quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Full catalog refresh from the static CSV datafeed (nightly). Falls back to
 * the paged API datafeed for the given domain when no CSV URL is configured.
 */
export async function ingestProducts(domain: string, cat?: string): Promise<IngestResult> {
  const approved = await approvedMerchants();
  let processed = 0;
  let skipped = 0;

  const csvUrl = process.env.ACCESSTRADE_CSV_URL;
  if (csvUrl) {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`CSV datafeed fetch failed: ${res.status}`);
    const records = parseCsv(await res.text());
    const items: AtDatafeedItem[] = [];
    for (const r of records) {
      const merchant = (r.merchant ?? "").toLowerCase();
      if (!approved.has(merchant)) {
        skipped++;
        continue;
      }
      // Header may be `cate` (matching the API) or `category`; accept either.
      if (cat && (r.cate || r.category) !== cat) continue;
      items.push({
        product_id: r.product_id,
        merchant,
        domain: r.domain || domain,
        name: r.name,
        price: Number(r.price),
        discount: r.discount ? Number(r.discount) : undefined,
        image: r.image || undefined,
        // CSV exports have been seen using either header; accept both.
        cate: r.cate || r.category || undefined,
        aff_link: r.aff_link,
      });
    }
    // Batch to keep memory + Typesense import sizes sane.
    for (let i = 0; i < items.length; i += 500) {
      processed += await upsertAndIndex(items.slice(i, i + 500));
    }
    return { job: "products", processed, skippedUnapproved: skipped };
  }

  // API fallback (throttled by the adapter; bounded pages).
  const at = getAccessTrade();
  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const res = await at.datafeed(domain, cat, page, PAGE_LIMIT);
    const items = res.data ?? [];
    if (items.length === 0) break;
    const kept = items.filter((i) => {
      const ok = approved.has(i.merchant.toLowerCase());
      if (!ok) skipped++;
      return ok;
    });
    processed += await upsertAndIndex(kept);
    if (items.length < PAGE_LIMIT) break;
  }
  return { job: "products", processed, skippedUnapproved: skipped };
}

/**
 * Vouchers via /offers_informations (D6), refreshed every 6h (D3).
 * Idempotent on the natural key (merchant, content). Existing rows are
 * prefetched once and only diffs are written — the previous per-offer
 * findFirst+upsert was ~2 round-trips × 8k offers, which remote Postgres
 * (Neon) stretched to ~25 minutes.
 */
export async function ingestVouchers(merchant?: string): Promise<IngestResult> {
  const approved = await approvedMerchants();
  const at = getAccessTrade();
  let processed = 0;
  let skipped = 0;

  const existing = new Map(
    (await prisma.voucher.findMany()).map((v) => [`${v.merchant}:${v.content}`, v]),
  );
  const creates: { merchant: string; domain: string; content: string; code: string | null; affLink: string; endTime: Date | null }[] = [];

  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const res = await at.offers(merchant, page, PAGE_LIMIT);
    const offers = res.data ?? [];
    if (offers.length === 0) break;

    for (const o of offers) {
      const m = o.merchant.toLowerCase();
      if (!approved.has(m)) {
        skipped++;
        continue;
      }
      // Live rows nest codes in `coupons[]`; take the first code (if any) and
      // fall back to the offer's own description. `end_time` is "YYYY-MM-DD".
      const code = o.coupons?.find((c) => c.coupon_code)?.coupon_code ?? null;
      const endTime = o.end_time ? new Date(`${o.end_time}T23:59:59Z`) : null;
      if (endTime && Number.isNaN(endTime.getTime())) continue; // unparseable date

      const data = { merchant: m, domain: o.domain, content: o.content, code, affLink: o.aff_link, endTime };
      const prev = existing.get(`${m}:${o.content}`);
      if (!prev) {
        creates.push(data);
      } else if (
        prev.domain !== data.domain ||
        prev.code !== data.code ||
        prev.affLink !== data.affLink ||
        (prev.endTime?.getTime() ?? null) !== (data.endTime?.getTime() ?? null)
      ) {
        await prisma.voucher.update({ where: { id: prev.id }, data });
      }
      processed++;
    }
    if (offers.length < PAGE_LIMIT) break;
  }

  // Feed can repeat (merchant, content) across pages — last one wins, and a
  // single createMany keeps this one round-trip.
  const dedupedCreates = [...new Map(creates.map((c) => [`${c.merchant}:${c.content}`, c])).values()];
  if (dedupedCreates.length > 0) await prisma.voucher.createMany({ data: dedupedCreates });

  // Drop expired vouchers so hasVoucher stays honest.
  await prisma.voucher.deleteMany({ where: { endTime: { lt: new Date() } } });
  await resyncHasVoucher();
  return { job: "vouchers", processed, skippedUnapproved: skipped };
}

/** Top-sellers → salesRank quality proxy, then re-index affected products. */
export async function ingestTopSellers(): Promise<IngestResult> {
  const at = getAccessTrade();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let processed = 0;
  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const res = await at.topProducts(fmt(from), fmt(to), page, PAGE_LIMIT);
    const items = res.data ?? [];
    if (items.length === 0) break;
    for (const [i, t] of items.entries()) {
      // Feed may return an explicit `rank`; otherwise derive it from position
      // (results come back best-selling first). 1-based, lower = better.
      const salesRank = t.rank ?? (page - 1) * PAGE_LIMIT + i + 1;
      const updated = await prisma.product.updateMany({
        where: { merchant: t.merchant.toLowerCase(), productId: t.product_id },
        data: { salesRank },
      });
      processed += updated.count;
    }
    if (items.length < PAGE_LIMIT) break;
  }
  await resyncIndexFromDb();
  return { job: "top-sellers", processed, skippedUnapproved: 0 };
}

/**
 * CTR feedback loop: roll ClickEvent up into Product.clicks30d/completions30d
 * (30-day window). Runs nightly from scripts/ingest-all.ts; rank() reads the
 * counters at query time via hydrate(), so no Typesense re-sync is needed.
 * Synthetic ids (banner:*, service:*) have no Product row and drop out of the
 * join naturally.
 */
export async function aggregateEngagement(): Promise<IngestResult> {
  await prisma.$executeRaw`
    UPDATE "Product" SET "clicks30d" = 0, "completions30d" = 0
    WHERE "clicks30d" <> 0 OR "completions30d" <> 0`;
  const updated = await prisma.$executeRaw`
    UPDATE "Product" p
    SET "clicks30d" = s.clicks, "completions30d" = s.comps
    FROM (
      SELECT "productId",
             count(*)::int          AS clicks,
             count("completedAt")::int AS comps
      FROM "ClickEvent"
      WHERE "createdAt" >= now() - interval '30 days'
      GROUP BY "productId"
    ) s
    WHERE p.id = s."productId"`;
  return { job: "engagement", processed: updated, skippedUnapproved: 0 };
}

/** Re-sync hasVoucher flags in Typesense from current Postgres state. */
async function resyncHasVoucher(): Promise<void> {
  await resyncIndexFromDb();
}

/** Push current Postgres product state into Typesense (Postgres = truth, R14). */
async function resyncIndexFromDb(): Promise<void> {
  const batchSize = 500;
  const voucherMerchants = await merchantsWithActiveVouchers();
  for (let skip = 0; ; skip += batchSize) {
    const products = await prisma.product.findMany({ skip, take: batchSize });
    if (products.length === 0) break;
    await upsertProducts(
      products.map((p) => ({
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
    if (products.length < batchSize) break;
  }
}
