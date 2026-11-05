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
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { DEEPLINK_MERCHANTS } from "@/lib/config";
import { UTM_SOURCE, type ClickKind } from "@/lib/tracking/outbound";

export const runtime = "nodejs";

interface LinkRequest {
  url?: unknown;
}

export interface LinkResponse {
  affLink: string;
  /** shorten.asia link from AccessTrade; absent when the short-link API fails. */
  shortLink?: string;
  /** Short link on our own domain (/go/l/<slug>); absent when the DB write fails. */
  shareLink?: string;
  merchant: string;
  label: string;
}

const SLUG_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SLUG_LENGTH = 7;
const MAX_TARGET_URL_CHARS = 2000;

function newSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = "";
  for (const b of bytes) slug += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return slug;
}

/**
 * Best-effort /go/l slug for this URL — reuses the existing row when the same
 * URL was shared before, otherwise creates one (retrying on the rare slug
 * collision). Returns null on DB failure: the response then degrades to the
 * deep link, same philosophy as createShortLink.
 */
async function upsertSharedLink(
  merchant: string,
  targetUrl: string,
): Promise<string | null> {
  const byUrl = { merchant_targetUrl: { merchant, targetUrl } };
  try {
    const existing = await prisma.sharedLink.findUnique({ where: byUrl });
    if (existing) return existing.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await prisma.sharedLink.create({
          data: { id: newSlug(), merchant, targetUrl },
        });
        return created.id;
      } catch {
        // Unique violation: either a concurrent create of the same URL
        // (re-read finds it) or a slug collision (loop generates a new one).
        const concurrent = await prisma.sharedLink.findUnique({ where: byUrl });
        if (concurrent) return concurrent.id;
      }
    }
    return null;
  } catch (err) {
    console.error("[api/link] SharedLink upsert failed", err);
    return null;
  }
}

interface AtProductLinkResponse {
  success?: boolean;
  data?: {
    success_link?: Array<{ aff_link?: string; short_link?: string }>;
  };
}

/**
 * utm tags for the AccessTrade links themselves (aff_link + shorten.asia),
 * which bypass /go/l and so never get a ClickEvent. utm_content carries the
 * SharedLink slug instead of a clickId, so the conversions job can still
 * credit an order to the link that produced it.
 */
function directLinkUtm(slug: string | null): Record<string, string> {
  return {
    utm_source: UTM_SOURCE,
    utm_campaign: "link-direct" satisfies ClickKind,
    ...(slug ? { utm_content: slug } : {}),
  };
}

/** Best-effort shorten.asia link via AccessTrade — never fails the request. */
async function createShortLink(
  campaignId: string,
  targetUrl: string,
  utm: Record<string, string>,
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
      // utm_* are accepted here and echoed into aff_link (verified 2026-11-05).
      body: JSON.stringify({ campaign_id: campaignId, urls: [targetUrl], ...utm }),
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
  if (target.toString().length > MAX_TARGET_URL_CHARS) {
    return NextResponse.json({ error: "invalid_url" }, { status: 422 });
  }

  const merchant = matchMerchant(target.hostname);
  if (!merchant) {
    return NextResponse.json({ error: "unsupported_merchant" }, { status: 422 });
  }

  const publisherId = process.env.ACCESSTRADE_PUBLISHER_ID;
  const campaignId = process.env[merchant.envVar];
  if (!publisherId || !campaignId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const targetUrl = target.toString();
  // Slug first: it's the attribution id stamped on the AccessTrade links.
  const slug = await upsertSharedLink(merchant.merchant, targetUrl);
  const utm = directLinkUtm(slug);
  const composedUrl = new URL(`https://go.isclix.com/deep_link/${publisherId}/${campaignId}`);
  composedUrl.searchParams.set("url", targetUrl);
  for (const [k, v] of Object.entries(utm)) composedUrl.searchParams.set(k, v);
  const composed = composedUrl.toString();
  const short = await createShortLink(campaignId, targetUrl, utm);
  return NextResponse.json({
    // Prefer AccessTrade's own aff_link (it carries their sub-id tagging).
    affLink: short.affLink ?? composed,
    shortLink: short.shortLink,
    shareLink: slug ? `${req.nextUrl.origin}/go/l/${slug}` : undefined,
    merchant: merchant.merchant,
    label: merchant.label,
  } satisfies LinkResponse);
}
