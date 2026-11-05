// GET /go/l/[slug] — tracked redirect for "Tạo link" short links. The slug
// maps to a SharedLink row created by POST /api/link; only the pasted product
// URL is stored, and the AccessTrade deep link is composed here at redirect
// time. Same invariants as /go/[id], /go/b and /go/s:
//  - Destination composed ONLY server-side (SharedLink row + DEEPLINK_MERCHANTS
//    + env publisher/campaign ids) — never from the query string.
//  - Fresh clickId per hit: ClickEvent (fire-and-forget, synthetic
//    link:<slug> productId), attribution cookie re-armed, clickId as utm_content on the
//    outbound link. IP salted-hashed.
//  - Unknown slug, unknown merchant, or unset env var → 404 (fails closed:
//    a link shared before a campaign was disabled must stop working).

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_S,
  DEEPLINK_MERCHANTS,
} from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";
import { withClickTracking } from "@/lib/tracking/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_PATTERN = /^[a-zA-Z0-9]{4,16}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  if (!SLUG_PATTERN.test(slug)) notFound();

  const link = await prisma.sharedLink.findUnique({ where: { id: slug } });
  const merchant = link
    ? DEEPLINK_MERCHANTS.find((m) => m.merchant === link.merchant)
    : undefined;
  const campaignId = merchant ? process.env[merchant.envVar] : undefined;
  const publisherId = process.env.ACCESSTRADE_PUBLISHER_ID;
  if (!link || !campaignId || !publisherId) notFound();

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Fire-and-forget: the redirect must not wait on the DB write.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: `link:${link.id}`,
        merchant: link.merchant,
        campaign: campaignId,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview: isWebviewUa(ua),
      },
    })
    .catch((err) => console.error("[go/l] ClickEvent write failed", err));

  const url = new URL(`https://go.isclix.com/deep_link/${publisherId}/${campaignId}`);
  url.searchParams.set("url", link.targetUrl);

  const res = NextResponse.redirect(withClickTracking(url.toString(), clickId, "link"), 302);
  res.cookies.set(ATTRIBUTION_COOKIE, clickId, {
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_S, // re-armed on every hit (PRD §3.3)
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
