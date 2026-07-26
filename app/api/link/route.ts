// POST /api/link — "Tạo link" tab: convert a pasted marketplace product URL
// into an AccessTrade deep link. Publisher + campaign ids are read from env
// only (never shipped to the client); the composed link itself IS the output
// the user shares, so returning it does not violate the cloaking invariant —
// unlike product CTAs, disclosure here is the point.
// The deep link itself is composed locally from a URL template
// (https://go.isclix.com/deep_link/<publisher_id>/<campaign_id>?url=<encoded>).
// A shorten.asia short link is then requested from AccessTrade's
// /v1/product_link/create (verified live 2026-07-26) — the one deliberate
// exception to "no AccessTrade on request paths": it's a single low-volume
// call per link created, kept off the throttled ingestion adapter and made
// best-effort with a timeout, so a rate-limit hit degrades to deeplink-only
// instead of failing the request.

import { NextRequest, NextResponse } from "next/server";
import { DEEPLINK_MERCHANTS } from "@/lib/config";

export const runtime = "nodejs";

interface LinkRequest {
  url?: unknown;
}

export interface LinkResponse {
  affLink: string;
  /** shorten.asia link from AccessTrade; absent when the short-link API fails. */
  shortLink?: string;
  merchant: string;
  label: string;
}

interface AtProductLinkResponse {
  success?: boolean;
  data?: {
    success_link?: Array<{ aff_link?: string; short_link?: string }>;
  };
}

/** Best-effort shorten.asia link via AccessTrade — never fails the request. */
async function createShortLink(
  campaignId: string,
  targetUrl: string,
): Promise<{ affLink?: string; shortLink?: string }> {
  const token = process.env.ACCESSTRADE_TOKEN;
  if (!token) return {};
  try {
    const res = await fetch("https://api.accesstrade.vn/v1/product_link/create", {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ campaign_id: campaignId, urls: [targetUrl] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as AtProductLinkResponse;
    const link = body.data?.success_link?.[0];
    return { affLink: link?.aff_link, shortLink: link?.short_link };
  } catch {
    return {};
  }
}

function matchMerchant(hostname: string) {
  const host = hostname.toLowerCase();
  return DEEPLINK_MERCHANTS.find((m) =>
    m.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: LinkRequest;
  try {
    body = (await req.json()) as LinkRequest;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body.url !== "string" || body.url.trim() === "") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(body.url.trim());
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 422 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "invalid_url" }, { status: 422 });
  }
  // Never embed pasted credentials into a shareable link.
  target.username = "";
  target.password = "";

  const merchant = matchMerchant(target.hostname);
  if (!merchant) {
    return NextResponse.json({ error: "unsupported_merchant" }, { status: 422 });
  }

  const publisherId = process.env.ACCESSTRADE_PUBLISHER_ID;
  const campaignId = process.env[merchant.envVar];
  if (!publisherId || !campaignId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const composed = `https://go.isclix.com/deep_link/${publisherId}/${campaignId}?url=${encodeURIComponent(target.toString())}`;
  const short = await createShortLink(campaignId, target.toString());
  return NextResponse.json({
    // Prefer AccessTrade's own aff_link (it carries their sub-id tagging).
    affLink: short.affLink ?? composed,
    shortLink: short.shortLink,
    merchant: merchant.merchant,
    label: merchant.label,
  } satisfies LinkResponse);
}
