// Conversion reconciliation (PRD v1.5 / F11): pulls AccessTrade's
// /v1/transactions into the Conversion table so orders and commission can be
// joined back to our clicks via utm_content (see lib/tracking/outbound.ts).
//
// AccessTrade updates a conversion's status long after the order (pending →
// approved/rejected, then locked for payout), so each run re-syncs a rolling
// window and upserts — re-running is always safe.

import { prisma } from "@/lib/db";
import { getAccessTrade, type AtTransaction } from "@/lib/affiliate/accesstrade";
import type { IngestResult } from "./accesstrade-ingest";

const DAY_MS = 24 * 3600 * 1000;
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

/** "2026-10-09T15:13:38" + "+00:00" → Date. Undefined on missing/garbage. */
function parseAtTime(value: string | undefined, tz = "+00:00"): Date | undefined {
  if (!value) return undefined;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasOffset ? value : `${value}${tz}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const orNull = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

export function toConversionRow(t: AtTransaction) {
  const tz = t.time_zone || "+00:00";
  const transactionTime = parseAtTime(t.transaction_time, tz);
  // conversion_id is the per-line key; `id` repeats across an order's lines.
  if (!transactionTime || t.conversion_id == null) return null; // unusable row; skip rather than guess
  return {
    id: String(t.conversion_id),
    atOrderKey: t.id,
    isBrandBonus: t.is_brand_bonus === true,
    merchant: t.merchant,
    campaignNo: orNull(t.campaign_no),
    orderId: orNull(t.transaction_id),
    productName: orNull(t.product_name)?.slice(0, 500) ?? null,
    quantity: t.product_quantity ?? null,
    status: t.status,
    isConfirmed: t.is_confirmed === 1,
    commissionVnd: Math.round(t.commission ?? 0),
    orderValueVnd: Math.round(t.transaction_value ?? 0),
    reasonRejected: orNull(t.reason_rejected),
    utmSource: orNull(t.utm_source),
    utmCampaign: orNull(t.utm_campaign),
    utmContent: orNull(t.utm_content),
    clickReferer: orNull(t._extra?.parameters?.click_referer)?.slice(0, 500) ?? null,
    clickTime: parseAtTime(t.click_time, tz) ?? null,
    transactionTime,
    atUpdatedAt: parseAtTime(t.update_time, tz) ?? null,
  };
}

/** Sync conversions with transaction_time in the last `days` days. */
export async function ingestConversions(days = 90): Promise<IngestResult> {
  const at = getAccessTrade();
  const until = new Date();
  const since = new Date(until.getTime() - days * DAY_MS);

  let processed = 0;
  let skipped = 0;
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const res = await at.transactions(since, until, page, PAGE_SIZE);
    const rows = res.data ?? [];
    if (res.total_page) totalPages = res.total_page;
    for (const t of rows) {
      const row = toConversionRow(t);
      if (!row) {
        skipped++;
        continue;
      }
      await prisma.conversion.upsert({ where: { id: row.id }, create: row, update: row });
      processed++;
    }
    if (rows.length === 0) break;
  }
  if (totalPages > MAX_PAGES) {
    // Fail loud (R13): a silently truncated sync under-reports revenue.
    throw new Error(`conversions: ${totalPages} pages exceeds MAX_PAGES=${MAX_PAGES}; shorten the window`);
  }
  return { job: "conversions", processed, skippedUnapproved: skipped };
}
