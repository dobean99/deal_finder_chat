// GET /go/m/[slug]?q=<query> — tracked redirect to a marketplace's own search
// results (Shopee/Lazada), for queries the catalog can't serve. Same
// invariants as /go/[id], /go/b, /go/s:
//  - Destination composed ONLY server-side from MARKETPLACE_SEARCH + env.
//    `q` is a plain-text search phrase interpolated into a fixed URL template
//    — never a URL, so no open redirect surface. Length-capped, URL-encoded.
//  - Fresh clickId per hit: ClickEvent (fire-and-forget, synthetic
//    msearch:<slug> productId), attribution cookie re-armed, clickId as utm_content on the
//    outbound link. IP salted-hashed.
//  - Unknown slug or unset campaign env var → 404 (fails closed).

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_S,
  MARKETPLACE_SEARCH,
} from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";
import { withClickTracking } from "@/lib/tracking/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CHARS = 100;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;

  const market = MARKETPLACE_SEARCH.find((m) => m.slug === slug);
  const campaignId = market ? process.env[market.envVar] : undefined;
  const publisherId = process.env.ACCESSTRADE_PUBLISHER_ID;
  if (!market || !campaignId || !publisherId) notFound();

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_CHARS);
  if (!q) notFound(); // a search handoff without a query is meaningless
  const target = market.searchUrl.replace("{q}", encodeURIComponent(q));

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Fire-and-forget: the redirect must not wait on the DB write.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: `msearch:${market.slug}`,
        merchant: market.merchant,
        campaign: campaignId,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview: isWebviewUa(ua),
      },
    })
    .catch((err) => console.error("[go/m] ClickEvent write failed", err));

  const url = new URL(`https://go.isclix.com/deep_link/${publisherId}/${campaignId}`);
  url.searchParams.set("url", target);

  const res = NextResponse.redirect(withClickTracking(url.toString(), clickId, "msearch"), 302);
  res.cookies.set(ATTRIBUTION_COOKIE, clickId, {
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_S, // re-armed on every hit (PRD §3.3)
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
