// Ranking per PRD §7 (+ engagement extension):
//   score = 0.40·priceScore + 0.30·voucherScore + 0.15·qualityScore + 0.15·engagementScore
// Weights come from config, never hardcoded here or at call sites.
// priceScore is normalized within the result set; voucherScore saturates via
// 1 − e^(−n/K); qualityScore derives from salesRank (lower rank = better);
// engagementScore is our own 30-day click/completion signal (CTR feedback
// loop) with the same saturating shape.

import {
  RANKING_WEIGHTS,
  VOUCHER_SATURATION_K,
  ENGAGEMENT_SATURATION_K,
  COMPLETION_CLICK_WORTH,
} from "@/lib/config";

export interface SearchIntent {
  keywords: string[];
  category?: string;
  brand?: string;
  priceMin?: number; // integer VND
  priceMax?: number; // integer VND
  mustHaveVoucher?: boolean;
  /** Set when the prompt is a service need (tickets/booking), not a product —
   * routes to SERVICE_MERCHANTS referrals instead of product search. */
  serviceType?: import("@/lib/config").ServiceType;
  /** Place name for service needs ("Đà Lạt"); used in referral search URLs. */
  destination?: string;
}

export interface VoucherInfo {
  id: string;
  content: string;
  code?: string;
  endTime?: Date;
}

export interface Candidate {
  id: string; // internal Product.id — becomes /go/{id}
  name: string;
  merchant: string;
  domain: string;
  price: number;
  originalPrice?: number;
  image?: string;
  category?: string;
  salesRank?: number;
  /** 30-day click count from our own ClickEvent log (nightly aggregation). */
  clicks30d?: number;
  /** 30-day completed-redirect count — a click that fired the beacon. */
  completions30d?: number;
  vouchers: VoucherInfo[];
}

export interface RankedCandidate extends Candidate {
  score: number;
  priceScore: number;
  voucherScore: number;
  qualityScore: number;
  engagementScore: number;
}

/** Rank candidates by the composite score, best first. */
export function rank(candidates: Candidate[]): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const prices = candidates.map((c) => c.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  // Quality: map salesRank (1 = best seller) to 0–1 within the result set.
  const ranks = candidates.filter((c) => c.salesRank != null).map((c) => c.salesRank as number);
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;

  const ranked = candidates.map((c): RankedCandidate => {
    const priceScore = priceRange > 0 ? (maxPrice - c.price) / priceRange : 0.5;
    const voucherScore = 1 - Math.exp(-c.vouchers.length / VOUCHER_SATURATION_K);
    const qualityScore =
      c.salesRank != null && maxRank > 0 ? (maxRank - c.salesRank + 1) / maxRank : 0;
    const weightedClicks =
      (c.clicks30d ?? 0) + COMPLETION_CLICK_WORTH * (c.completions30d ?? 0);
    const engagementScore = 1 - Math.exp(-weightedClicks / ENGAGEMENT_SATURATION_K);

    const score =
      RANKING_WEIGHTS.price * priceScore +
      RANKING_WEIGHTS.voucher * voucherScore +
      RANKING_WEIGHTS.quality * qualityScore +
      RANKING_WEIGHTS.engagement * engagementScore;

    return { ...c, score, priceScore, voucherScore, qualityScore, engagementScore };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
