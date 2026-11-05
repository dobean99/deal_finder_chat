// GET /go/s/[slug]?d=<destination> — tracked redirect for service referrals
// (Vexere, Gotadi, Atadi, Klook). Same invariants as /go/[id] and /go/b:
//  - Destination composed ONLY server-side from SERVICE_MERCHANTS + env
//    (publisher + campaign ids). `d` is a plain-text place name interpolated
//    into a fixed merchant search-URL template — never a URL, so no open
//    redirect surface. Length-capped and URL-encoded.
//  - Fresh clickId per hit: ClickEvent (fire-and-forget, synthetic
//    service:<slug> productId), attribution cookie re-armed, clickId as utm_content on the
//    outbound link. IP salted-hashed.
//  - Unknown slug or unset env var → 404 (fails closed; the chat route only
//    offers configured merchants, but the URL must not trust that).

import { NextRequest, NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_S,
  SERVICE_MERCHANTS,
} from "@/lib/config";
import { hashIp } from "@/lib/tracking/ip";
import { isWebviewUa } from "@/lib/tracking/webview";
import { withClickTracking } from "@/lib/tracking/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DESTINATION_CHARS = 80;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;

  const service = SERVICE_MERCHANTS.find((s) => s.slug === slug);
  const campaignId = service ? process.env[service.envVar] : undefined;
  const publisherId = process.env.ACCESSTRADE_PUBLISHER_ID;
  if (!service || !campaignId || !publisherId) notFound();

  const place = (req.nextUrl.searchParams.get("d") ?? "").trim().slice(0, MAX_DESTINATION_CHARS);
  const target =
    service.searchUrl && place
      ? service.searchUrl.replace("{q}", encodeURIComponent(place))
      : service.homeUrl;

  const clickId = randomUUID();
  const ua = req.headers.get("user-agent") ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Fire-and-forget: the redirect must not wait on the DB write.
  prisma.clickEvent
    .create({
      data: {
        clickId,
        productId: `service:${service.slug}`,
        merchant: service.merchant,
        campaign: campaignId,
        ipHash: ip ? hashIp(ip) : null,
        ua: ua.slice(0, 500),
        isWebview: isWebviewUa(ua),
      },
    })
    .catch((err) => console.error("[go/s] ClickEvent write failed", err));

  const url = new URL(`https://go.isclix.com/deep_link/${publisherId}/${campaignId}`);
  url.searchParams.set("url", target);

  const res = NextResponse.redirect(withClickTracking(url.toString(), clickId, "service"), 302);
  res.cookies.set(ATTRIBUTION_COOKIE, clickId, {
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_S, // re-armed on every hit (PRD §3.3)
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
