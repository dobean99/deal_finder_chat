// Stamps our clickId onto an outbound AccessTrade tracking link so a
// conversion can be joined back to the exact click that caused it (F11).
//
// AccessTrade's go.isclix.com deep links accept utm_source / utm_campaign /
// utm_content (verified 2026-11-05: /v1/product_link/create echoes them into
// aff_link), and /v1/transactions returns the same utm_* fields on every
// conversion. So:
//   utm_source   = UTM_SOURCE        — "came from this site"
//   utm_campaign = kind              — which surface (product, voucher, …)
//   utm_content  = clickId           — the ClickEvent join key
// The conversions ingest job (lib/ingest/conversions.ts) reads these back.

export const UTM_SOURCE = "dealfinder";

/** Which surface a click came from; lands in utm_campaign. */
export type ClickKind =
  | "product"
  | "voucher"
  | "link"
  | "link-direct"
  | "msearch"
  | "service"
  | "banner";

/**
 * Returns `link` with our tracking params set. A malformed link is returned
 * unchanged — the redirect must still work even if attribution can't be added.
 */
export function withClickTracking(link: string, clickId: string, kind: ClickKind): string {
  try {
    const url = new URL(link);
    url.searchParams.set("utm_source", UTM_SOURCE);
    url.searchParams.set("utm_campaign", kind);
    url.searchParams.set("utm_content", clickId);
    return url.toString();
  } catch {
    return link;
  }
}
