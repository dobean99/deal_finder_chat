// GET /api/vouchers?merchant=&offset= — active vouchers for the Voucher tab,
// soonest-expiring first. Raw aff_link never leaves the server (cloaking
// invariant, same as chat results) — cards link to /go/v/<id> instead.
// AccessTrade voucher content arrives as "[Shop] [Shop]-Giảm …"; it's parsed
// here into shop + title so the client stays presentation-only.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
// Sanity bound only — paging is driven by `total`, so this just caps abuse.
const MAX_OFFSET = 100_000;

export interface VoucherItem {
  id: string;
  merchant: string;
  shop: string | null;
  title: string;
  code: string | null;
  /** ISO date; null = no published expiry. */
  endTime: string | null;
}

export interface VouchersResponse {
  vouchers: VoucherItem[];
  total: number;
  /** Distinct merchants with active vouchers — drives the filter pills. */
  merchants: string[];
}

/** "[Shop] [Shop]-Giảm 20,000 VNĐ…" → shop "Shop", title "Giảm 20,000 VNĐ…". */
function parseContent(content: string): { shop: string | null; title: string } {
  const cut = content.lastIndexOf("]-");
  if (cut === -1) return { shop: null, title: content.trim() };
  const shop = content.match(/^\s*\[([^\]]+)\]/)?.[1] ?? null;
  const title = content.slice(cut + 2).trim();
  return title ? { shop, title } : { shop: null, title: content.trim() };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const merchant = req.nextUrl.searchParams.get("merchant") ?? undefined;
  const rawOffset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const offset = Number.isInteger(rawOffset)
    ? Math.min(Math.max(rawOffset, 0), MAX_OFFSET)
    : 0;

  // Ingest deletes expired rows every 6h; the endTime filter covers the gap.
  const active = {
    ...(merchant ? { merchant } : {}),
    OR: [{ endTime: null }, { endTime: { gt: new Date() } }],
  };

  const [rows, total, byMerchant] = await Promise.all([
    prisma.voucher.findMany({
      where: active,
      orderBy: [{ endTime: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      skip: offset,
      take: PAGE_SIZE,
    }),
    prisma.voucher.count({ where: active }),
    prisma.voucher.groupBy({
      by: ["merchant"],
      where: { OR: [{ endTime: null }, { endTime: { gt: new Date() } }] },
    }),
  ]);

  return NextResponse.json({
    vouchers: rows.map((v) => ({
      id: v.id,
      merchant: v.merchant,
      ...parseContent(v.content),
      code: v.code,
      endTime: v.endTime?.toISOString() ?? null,
    })),
    total,
    merchants: byMerchant.map((m) => m.merchant).sort(),
  } satisfies VouchersResponse);
}
