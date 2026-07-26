// Central config. Ranking weights live here (PRD §7 — tunable, never hardcoded
// at call sites). Env access is centralized so missing vars fail loudly once.

export const RANKING_WEIGHTS = {
  price: 0.4,
  voucher: 0.3,
  quality: 0.15,
  engagement: 0.15,
} as const;

/** Saturation constant for voucherScore = 1 − e^(−n/K). */
export const VOUCHER_SATURATION_K = 2;

/**
 * Saturation constant for engagementScore = 1 − e^(−(clicks + 3·completions)/K).
 * A completed redirect is worth 3 raw clicks; K=5 means ~5 weighted clicks in
 * 30 days ≈ 0.63 score — small catalogs saturate fast, which is intended: the
 * signal distinguishes "chosen at all" from "never chosen", not raw volume.
 */
export const ENGAGEMENT_SATURATION_K = 5;
export const COMPLETION_CLICK_WORTH = 3;

/** Attribution cookie name + lifetime; maxAge is re-armed on every /go hit. */
export const ATTRIBUTION_COOKIE = "df_click";
export const ATTRIBUTION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

/** Result set size bounds (PRD F1: 3–8 items). */
export const MIN_RESULTS = 3;
export const MAX_RESULTS = 8;

/**
 * Header promo banner: approved F&B campaigns promoted above the chat.
 * The affiliate URL lives in env (never in the client bundle — same cloaking
 * invariant as product CTAs); a tile renders only when its env var is set.
 * campaignId/merchant match AccessTrade `/v1/campaigns` for reconciliation.
 */
export const BANNER_CAMPAIGNS = [
  {
    slug: "shopee",
    name: "Shopee — Voucher tới 50%",
    envVar: "BANNER_SHOPEE_URL",
    merchant: "shopee",
    campaignId: "4751584435713464237",
  },
  {
    slug: "highlands",
    name: "Highlands Coffee",
    envVar: "BANNER_HIGHLANDS_URL",
    merchant: "highland_antsomi_zalo",
    campaignId: "6709203674879803188",
  },
  {
    slug: "thecoffeehouse",
    name: "The Coffee House",
    envVar: "BANNER_TCH_URL",
    merchant: "thecoffeehouse_cpv",
    campaignId: "6699917486599106569",
  },
] as const;

export type BannerCampaign = (typeof BANNER_CAMPAIGNS)[number];

/**
 * "Tạo link" tab: merchants whose product URLs can be converted to an
 * AccessTrade deep link (format documented in .env.example:
 * https://go.isclix.com/deep_link/<publisher_id>/<campaign_id>?url=<encoded>).
 * Campaign ids live in env; a merchant whose env var is unset is rejected
 * server-side (fails closed, same pattern as BANNER_CAMPAIGNS).
 */
export const DEEPLINK_MERCHANTS = [
  {
    merchant: "shopee",
    label: "Shopee",
    hosts: ["shopee.vn", "shp.ee"],
    envVar: "DEEPLINK_CAMPAIGN_SHOPEE",
  },
  {
    merchant: "lazada",
    label: "Lazada",
    hosts: ["lazada.vn", "s.lazada.vn"],
    envVar: "DEEPLINK_CAMPAIGN_LAZADA",
  },
  {
    merchant: "tiktokshop",
    label: "TikTok Shop",
    hosts: ["tiktok.com", "vt.tiktok.com"],
    envVar: "DEEPLINK_CAMPAIGN_TIKTOK",
  },
] as const;

export type DeeplinkMerchant = (typeof DEEPLINK_MERCHANTS)[number];

/**
 * Service referrals: service needs ("vé xe đi Đà Lạt") have no product
 * datafeed on AccessTrade (verified 2026-07-26: vexere, gotadi, atadi and
 * klookvn all return total=0 from /v1/datafeeds — tickets are dynamic
 * inventory), so the chat answers them with a tracked referral card to the
 * merchant instead of mis-matching physical products. The env var holds the
 * AccessTrade campaign id (same convention as DEEPLINK_MERCHANTS); a merchant
 * whose var is unset never renders (fails closed). `searchUrl` may embed a
 * {q} placeholder for the parsed destination; merchants without a stable
 * search-URL scheme link to the homepage — the deep link still attributes.
 */
export type ServiceType = "bus" | "flight" | "activity";

export const SERVICE_MERCHANTS: readonly {
  slug: string;
  merchant: string;
  label: string;
  tagline: string;
  serviceTypes: readonly ServiceType[];
  envVar: string;
  homeUrl: string;
  searchUrl: string | null;
}[] = [
  {
    slug: "vexere",
    merchant: "vexere",
    label: "Vexere",
    tagline: "Vé xe khách & limousine khắp Việt Nam",
    serviceTypes: ["bus"],
    envVar: "SERVICE_CAMPAIGN_VEXERE",
    homeUrl: "https://vexere.com",
    searchUrl: null,
  },
  {
    slug: "gotadi",
    merchant: "gotadi",
    label: "Gotadi",
    tagline: "Vé máy bay giá rẻ",
    serviceTypes: ["flight"],
    envVar: "SERVICE_CAMPAIGN_GOTADI",
    homeUrl: "https://www.gotadi.com",
    searchUrl: null,
  },
  {
    slug: "atadi",
    merchant: "atadi",
    label: "Atadi",
    tagline: "Săn vé máy bay trực tuyến",
    serviceTypes: ["flight"],
    envVar: "SERVICE_CAMPAIGN_ATADI",
    homeUrl: "https://atadi.vn",
    searchUrl: null,
  },
  {
    slug: "klook",
    merchant: "klookvn",
    label: "Klook",
    tagline: "Tour, vé tham quan, SIM du lịch",
    serviceTypes: ["activity"],
    envVar: "SERVICE_CAMPAIGN_KLOOK",
    homeUrl: "https://www.klook.com/vi/",
    searchUrl: "https://www.klook.com/vi/search/?query={q}",
  },
] as const;

export type ServiceMerchant = (typeof SERVICE_MERCHANTS)[number];

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function envOptional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}
