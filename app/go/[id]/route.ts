// GET /go/[id]?c=<campaign> — the tracked redirect (invariants 2 + 3, D1/F10/F11).
//  - Destination resolved ONLY from Postgres by id; unknown id → 404. The query
//    string is never used as a destination (no open redirect).
//  - A fresh clickId per hit: written as a ClickEvent (fire-and-forget), set as
//    the attribution cookie (maxAge re-armed every hit), AND stamped on the
//    outbound URL as utm_content=<clickId> (lib/tracking/outbound.ts) — the
//    join key AccessTrade echoes back on each conversion (F11).
//  - Webview detection is UA-based and recorded as isWebview; v1 still routes
//    through the AccessTrade aff_link (their server-side tracking survives
//    webviews). No hand-built native deeplinks until completion data says so.
//  - IP is salted-hashed before logging; no raw PII (D5).

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_COOKIE_MAX_AGE_S } from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";
import { withClickTracking } from "@/lib/tracking/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound(); // renders app/not-found.tsx with a 404 status

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const isWebview = isWebviewUa(ua);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const campaign = req.nextUrl.searchParams.get("c") ?? undefined;

  // Fire-and-forget: the redirect must not wait on the DB write.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: product.id,
        merchant: product.merchant,
        campaign,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview,
      },
    })
    .catch((err) => console.error("[go] ClickEvent write failed", err));

  // clickId rides to AccessTrade as utm_content so the conversions job can
  // join orders back to this click (F11).
  const destination = withClickTracking(product.affLink, clickId, "product");

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
