// POST /api/chat — { prompt, campaign? } → { reply, matchLevel, results }.
// Pipeline: parse intent → Typesense search → join active vouchers + salesRank
// from Postgres → rank() → cards. Response NEVER contains affLink (inv. 2);
// each card links to /go/{id}. No-match cascade per D7: exact → relax price
// ceiling → widen to category → suggest adjacent categories — never a dead end.

import { NextRequest, NextResponse } from "next/server";
import { parseIntent } from "@/lib/intent/parse";
import { search, listCategories, buildQueryTerms } from "@/lib/search/typesense";
import { categorySlug, categoryLabel } from "@/lib/search/categories";
import { rank, type Candidate, type SearchIntent } from "@/lib/affiliate/ranking";
import { prisma } from "@/lib/db";
import { MAX_RESULTS, SERVICE_MERCHANTS, MARKETPLACE_SEARCH } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MatchLevel =
  | "exact"
  | "price-relaxed"
  | "brand-relaxed"
  | "category"
  | "adjacent"
  | "service";

/** Referral card for service needs (tickets/booking) — no product datafeed
 * exists for these merchants, so the chat links to them directly (tracked). */
export interface ServiceCard {
  slug: string;
  label: string;
  tagline: string;
  merchant: string;
  href: string; // /go/s/{slug}?d=destination
}

export interface ResultCard {
  id: string;
  name: string;
  merchant: string;
  price: number;
  originalPrice?: number;
  image?: string;
  vouchers: { content: string; code?: string }[];
  /** "phổ biến" flag from top-sellers — never a rating (invariant 5). */
  popular: boolean;
  href: string; // /go/{id}?c=campaign
}

export interface ChatResponse {
  reply: string;
  matchLevel: MatchLevel;
  results: ResultCard[];
  adjacentCategories?: string[];
  services?: ServiceCard[];
  /** Tracked handoffs to marketplace search results — attached when the
   * catalog couldn't serve the query exactly (the AccessTrade feeds are thin
   * slices of the real marketplaces). */
  searchLinks?: { label: string; merchant: string; query: string; href: string }[];
}

/** Marketplace search handoffs for the query (configured merchants only). */
function searchLinks(intent: SearchIntent): ChatResponse["searchLinks"] {
  if (!process.env.ACCESSTRADE_PUBLISHER_ID) return undefined;
  const q = buildQueryTerms(intent, false);
  if (q === "*") return undefined;
  const links = MARKETPLACE_SEARCH.filter((m) => process.env[m.envVar]).map((m) => ({
    label: m.label,
    merchant: m.merchant,
    query: q,
    href: `/go/m/${m.slug}?q=${encodeURIComponent(q)}`,
  }));
  return links.length > 0 ? links : undefined;
}

/** Configured referral merchants for a service intent (fails closed per
 * merchant: unset campaign env var or missing publisher id → not offered). */
function serviceCards(intent: SearchIntent): ServiceCard[] {
  if (!intent.serviceType || !process.env.ACCESSTRADE_PUBLISHER_ID) return [];
  const d = intent.destination?.trim();
  return SERVICE_MERCHANTS.filter(
    (s) => s.serviceTypes.includes(intent.serviceType!) && process.env[s.envVar],
  ).map((s) => ({
    slug: s.slug,
    label: s.label,
    tagline: s.tagline,
    merchant: s.merchant,
    href: `/go/s/${s.slug}${d ? `?d=${encodeURIComponent(d)}` : ""}`,
  }));
}

/** Join active vouchers + fresh price/salesRank from Postgres onto search hits. */
async function hydrate(candidates: Candidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const merchants = [...new Set(products.map((p) => p.merchant))];
  const vouchers = await prisma.voucher.findMany({
    where: {
      merchant: { in: merchants },
      OR: [{ endTime: null }, { endTime: { gte: new Date() } }],
    },
  });
  const byMerchant = new Map<string, typeof vouchers>();
  for (const v of vouchers) {
    const list = byMerchant.get(v.merchant) ?? [];
    list.push(v);
    byMerchant.set(v.merchant, list);
  }

  return candidates.flatMap((c) => {
    const p = byId.get(c.id);
    if (!p) return []; // index drift (R14) — Postgres is truth, drop phantom hits
    return [
      {
        ...c,
        name: p.name,
        merchant: p.merchant,
        domain: p.domain,
        price: p.price,
        originalPrice: p.originalPrice ?? undefined,
        image: p.image ?? undefined,
        category: p.category ?? undefined,
        salesRank: p.salesRank ?? undefined,
        clicks30d: p.clicks30d,
        completions30d: p.completions30d,
        vouchers: (byMerchant.get(p.merchant) ?? []).map((v) => ({
          id: v.id,
          content: v.content,
          code: v.code ?? undefined,
          endTime: v.endTime ?? undefined,
        })),
      },
    ];
  });
}

function toCards(candidates: Candidate[], campaign?: string): ResultCard[] {
  const c = campaign ? `?c=${encodeURIComponent(campaign)}` : "";
  return rank(candidates)
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      id: r.id,
      name: r.name,
      merchant: r.merchant,
      price: r.price,
      originalPrice: r.originalPrice,
      image: r.image,
      vouchers: r.vouchers.slice(0, 3).map((v) => ({ content: v.content, code: v.code })),
      popular: r.salesRank != null,
      href: `/go/${r.id}${c}`,
    }));
}

const REPLIES: Record<MatchLevel, string> = {
  exact: "Đây là vài lựa chọn tốt trong các sản phẩm tìm thấy:",
  "price-relaxed": "Không có đúng tầm giá đó — đây là những lựa chọn gần nhất:",
  "brand-relaxed": "Chưa có hàng của thương hiệu đó — đây là sản phẩm tương tự từ hãng khác:",
  category: "Không tìm thấy đúng sản phẩm — đây là các lựa chọn cùng danh mục:",
  adjacent: "Chưa có sản phẩm phù hợp. Bạn thử xem các danh mục gần đây:",
  service: "Nhu cầu này là dịch vụ đặt vé — bạn đặt trực tiếp qua đối tác dưới đây nhé:",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { prompt?: string; campaign?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const intent: SearchIntent = await parseIntent(prompt);

  // 0. Service needs (tickets/booking) have no product datafeed — refer to the
  // merchant instead of mis-matching physical products. Only fires when at
  // least one merchant for the type is configured; otherwise the product
  // cascade below still runs (its no-match steps beat a dead end).
  const services = serviceCards(intent);
  if (services.length > 0) {
    return NextResponse.json({
      reply: REPLIES.service,
      matchLevel: "service",
      results: [],
      services,
    } satisfies ChatResponse);
  }

  // D7 cascade — each step honestly labeled via matchLevel.
  // 1. Exact intent.
  let hits = await hydrate(await search(intent));
  if (hits.length > 0) {
    return NextResponse.json({
      reply: REPLIES.exact,
      matchLevel: "exact",
      results: toCards(hits, body?.campaign),
    } satisfies ChatResponse);
  }

  // 2. Relax the price ceiling.
  if (intent.priceMax != null) {
    hits = await hydrate(await search(intent, { ignorePriceMax: true }));
    if (hits.length > 0) {
      return NextResponse.json({
        reply: REPLIES["price-relaxed"],
        matchLevel: "price-relaxed",
      searchLinks: searchLinks(intent),
        results: toCards(hits, body?.campaign),
      } satisfies ChatResponse);
    }
  }

  // 3. Relax the brand: an unstocked brand ("CeraVe") must not dead-end into
  // category junk — same product type from other brands, honestly labeled.
  // Original price bounds still apply; they express budget, not preference.
  if (intent.brand) {
    hits = await hydrate(await search(intent, { ignoreBrand: true }));
    if (hits.length > 0) {
      return NextResponse.json({
        reply: REPLIES["brand-relaxed"],
        matchLevel: "brand-relaxed",
      searchLinks: searchLinks(intent),
        results: toCards(hits, body?.campaign),
      } satisfies ChatResponse);
    }
  }

  // 4. Widen to category.
  if (intent.category) {
    hits = await hydrate(
      await search(intent, { categoryOnly: true, ignorePriceMax: true }),
    );
    if (hits.length > 0) {
      return NextResponse.json({
        reply: REPLIES.category,
        matchLevel: "category",
      searchLinks: searchLinks(intent),
        results: toCards(hits, body?.campaign),
      } satisfies ChatResponse);
    }
  }

  // 5. Suggest 1–2 adjacent categories with a small sample from each.
  // listCategories() returns feed slugs — compare against the mapped intent
  // category, and show VN labels to the user (slugs are internal).
  const intentSlug = categorySlug(intent.category);
  const categories = (await listCategories()).filter((c) => c !== intentSlug).slice(0, 2);
  const samples: Candidate[] = [];
  for (const cat of categories) {
    const catHits = await hydrate(
      await search(intent, { categoryOnly: true, categoryOverride: cat, ignorePriceMax: true, limit: 4 }),
    );
    samples.push(...catHits);
  }
  return NextResponse.json({
    reply: REPLIES.adjacent,
    matchLevel: "adjacent",
      searchLinks: searchLinks(intent),
    results: toCards(samples, body?.campaign),
    adjacentCategories: categories.map(categoryLabel),
  } satisfies ChatResponse);
}
