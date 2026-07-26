// GET /api/suggestions — dynamic "hot" chips for the chat's suggestion row.
// "Hot" is our own first-party signal, not platform trending (Shopee/TikTok
// expose no public trending-search API and AccessTrade /top_products returns
// nothing on this account): products users actually clicked (clicks30d,
// completions weighted 3×), topped up with best-sellers (salesRank), then the
// static defaults. Chip text is the product name truncated to a query-sized
// prefix. Cached in-memory for 10 min — this is on the page path.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SuggestionsResponse {
  /** Query strings for chips; hot ones carry hot:true for a 🔥 prefix. */
  chips: { text: string; hot: boolean }[];
}

const CHIP_COUNT = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

const STATIC_EXAMPLES = [
  "Tai nghe chống ồn dưới 1 triệu",
  "Máy xay sinh tố cầm tay",
  "Giày chạy bộ nam khoảng 800k",
  "Nồi chiên không dầu có voucher",
];

/** Product name → chip-sized query: first 5 words, marketing shout stripped. */
function toQuery(name: string): string {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [FREESHIP], (Combo...) noise
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join(" ");
}

let cache: { at: number; body: SuggestionsResponse } | null = null;

export async function GET(): Promise<NextResponse> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const chips: { text: string; hot: boolean }[] = [];
  const seen = new Set<string>();
  const push = (text: string, hot: boolean) => {
    const key = text.toLowerCase();
    if (text && !seen.has(key) && chips.length < CHIP_COUNT) {
      seen.add(key);
      chips.push({ text, hot });
    }
  };

  try {
    // 1. Most-chosen products in the last 30 days (completions count 3×).
    const clicked = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM "Product"
      WHERE "clicks30d" > 0
      ORDER BY ("clicks30d" + 3 * "completions30d") DESC
      LIMIT ${CHIP_COUNT}`;
    for (const p of clicked) push(toQuery(p.name), true);

    // 2. Top up with best-sellers (feed's sales-volume proxy).
    if (chips.length < CHIP_COUNT) {
      const sellers = await prisma.product.findMany({
        where: { salesRank: { not: null } },
        orderBy: { salesRank: "asc" },
        take: CHIP_COUNT,
        select: { name: true },
      });
      for (const p of sellers) push(toQuery(p.name), true);
    }
  } catch (e) {
    console.warn("[suggestions] falling back to static:", e instanceof Error ? e.message : e);
  }

  // 3. Static defaults fill whatever data can't.
  for (const ex of STATIC_EXAMPLES) push(ex, false);

  const body: SuggestionsResponse = { chips };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
