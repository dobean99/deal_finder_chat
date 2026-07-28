// GET /go/v/[id] — tracked redirect for voucher CTAs on the Voucher tab.
// Same invariants as /go/[id], /go/b, /go/s and /go/l:
//  - Destination is the Voucher row's stored AccessTrade aff_link, resolved
//    ONLY server-side — never from the query string.
//  - Fresh clickId per hit: ClickEvent (fire-and-forget, synthetic
//    voucher:<id> productId), attribution cookie re-armed, ?dfclid= on the
//    outbound link. IP salted-hashed.
//  - Unknown id → 404. Expired vouchers are deleted by the 6h ingest, so
//    stale shared URLs fail closed on their own.

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_COOKIE_MAX_AGE_S } from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_PATTERN = /^[a-z0-9]{10,40}$/i;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) notFound();

  const voucher = await prisma.voucher.findUnique({ where: { id } });
  if (!voucher) notFound();

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Fire-and-forget: the redirect must not wait on the DB write.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: `voucher:${voucher.id}`,
        merchant: voucher.merchant,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview: isWebviewUa(ua),
      },
    })
    .catch((err) => console.error("[go/v] ClickEvent write failed", err));

  let destination: string;
  try {
    const url = new URL(voucher.affLink);
    url.searchParams.set("dfclid", clickId);
    destination = url.toString();
  } catch {
    destination = voucher.affLink; // malformed stored link — pass through as-is
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
