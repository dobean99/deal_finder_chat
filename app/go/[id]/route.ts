// GET /go/[id]?c=<campaign> — the tracked redirect (invariants 2 + 3, D1/F10/F11).
//  - Destination resolved ONLY from Postgres by id; unknown id → 404. The query
//    string is never used as a destination (no open redirect).
//  - A fresh clickId per hit: written as a ClickEvent (fire-and-forget), set as
//    the attribution cookie (maxAge re-armed every hit), AND appended to the
//    outbound URL as ?dfclid=<clickId> — the webview-resilient first-party
//    record that survives cookie stripping.
//  - Webview detection is UA-based and recorded as isWebview; v1 still routes
//    through the AccessTrade aff_link (their server-side tracking survives
//    webviews). No hand-built native deeplinks until completion data says so.
//  - IP is salted-hashed before logging; no raw PII (D5).

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_COOKIE_MAX_AGE_S } from "@/lib/config";
import { isWebviewUa } from "@/lib/tracking/webview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.IP_HASH_SALT ?? ""}:${ip}`)
    .digest("hex");
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return new NextResponse("Not found", { status: 404 });

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

  // Append clickId to the outbound aff_link (first-party click truth, F11).
  // NOTE (v1.5): paid-conversion reconciliation additionally needs clickId
  // stamped as a sub-id via AccessTrade's create-link endpoint — not built yet.
  let destination: string;
  try {
    const url = new URL(product.affLink);
    url.searchParams.set("dfclid", clickId);
    destination = url.toString();
  } catch {
    destination = product.affLink; // malformed stored link — pass through as-is
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
