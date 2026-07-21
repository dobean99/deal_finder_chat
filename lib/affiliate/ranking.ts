// Ranking per PRD §7:
//   score = 0.45·priceScore + 0.35·voucherScore + 0.20·qualityScore
// Weights come from config, never hardcoded here or at call sites.
// priceScore is normalized within the result set; voucherScore saturates via
// 1 − e^(−n/K); qualityScore derives from salesRank (lower rank = better).

import { RANKING_WEIGHTS, VOUCHER_SATURATION_K } from "@/lib/config";

export interface SearchIntent {
  keywords: string[];
  category?: string;
  brand?: string;
  priceMin?: number; // integer VND
  priceMax?: number; // integer VND
  mustHaveVoucher?: boolean;
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
  vouchers: VoucherInfo[];
}

export interface RankedCandidate extends Candidate {
  score: number;
  priceScore: number;
  voucherScore: number;
  qualityScore: number;
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

    const score =
      RANKING_WEIGHTS.price * priceScore +
      RANKING_WEIGHTS.voucher * voucherScore +
      RANKING_WEIGHTS.quality * qualityScore;

    return { ...c, score, priceScore, voucherScore, qualityScore };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
