// GET /go/b/[slug] — tracked redirect for header-banner campaigns (Highlands,
// The Coffee House). Same invariants as /go/[id]: destination resolved ONLY
// server-side (from BANNER_CAMPAIGNS + env, never the query string), fresh
// clickId per hit written as a ClickEvent + attribution cookie + ?dfclid=,
// IP salted-hashed. Unknown slug or unset env var → 404 (tile is hidden then,
// but the URL must still fail closed).

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_S,
  BANNER_CAMPAIGNS,
} from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;

  const banner = BANNER_CAMPAIGNS.find((b) => b.slug === slug);
  const affLink = banner ? process.env[banner.envVar] : undefined;
  if (!banner || !affLink) notFound(); // renders app/not-found.tsx with a 404 status

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Fire-and-forget: the redirect must not wait on the DB write. Banner clicks
  // have no Product row — the synthetic banner:<slug> id keeps them queryable.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: `banner:${banner.slug}`,
        merchant: banner.merchant,
        campaign: banner.campaignId,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview: isWebviewUa(ua),
      },
    })
    .catch((err) => console.error("[go/b] ClickEvent write failed", err));

  let destination: string;
  try {
    const url = new URL(affLink);
    url.searchParams.set("dfclid", clickId);
    destination = url.toString();
  } catch {
    destination = affLink; // malformed configured link — pass through as-is
  }

  const res = NextResponse.redirect(destination, 302);
  res.cookies.set(ATTRIBUTION_COOKIE, clickId, {
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_S, // re-armed on every hit (PRD §3.3)
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
