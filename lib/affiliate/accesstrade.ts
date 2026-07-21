// AccessTradeAdapter — the only place that talks to the AccessTrade API.
// ASSUMPTIONS (per PRD §3 / D6 / R16):
//  - Base URL https://api.accesstrade.vn/v1, auth "Authorization: Token <token>".
//  - Endpoints: /datafeeds (domain+cat filter only), /offers_informations
//    (vouchers per D6), /top_products, /campaigns.
//  - Rate limit ~30 req/min → internal throttle of 1 request / 2.1s, plus
//    retry-with-backoff on HTTP 400 bodies mentioning "rate limit" (AccessTrade
//    signals rate limiting with a 400, not 429).
// NEVER call this adapter on a user request path — ingestion only (invariant 1).

const BASE_URL = "https://api.accesstrade.vn/v1";
const MIN_REQUEST_INTERVAL_MS = 2100; // ≈28 req/min, safely under 30
const MAX_RETRIES = 5;

// Field names below are VERIFIED against live API responses (2026-07-19), not
// inferred from docs. Notable surprises: campaigns use `approval:"successful"`
// (not `affiliationStatus:"APPROVED"`); datafeed rows use `cate` (not
// `category`) and carry `discount`, not an original price; offers nest their
// codes in a `coupons[]` array.

export interface AtCampaign {
  id: string;
  merchant: string;
  /** "successful" = approved for this publisher; also "unregistered", "pending". */
  approval: string;
  status: number;
  name?: string;
}

export interface AtDatafeedItem {
  product_id: string;
  merchant: string;
  campaign?: string;
  domain: string;
  name: string;
  price: number;
  /**
   * NOT a usable discount. Observed as 6–33₫ on items priced 100k–445k, with
   * `discount_amount === price - discount`. Cannot reconstruct a list price;
   * see toProductFields() in lib/ingest/accesstrade-ingest.ts.
   */
  discount?: number;
  discount_amount?: number;
  image?: string;
  /** Category slug; frequently an empty string in the Shopee feed. */
  cate?: string;
  aff_link: string;
  url?: string;
}

export interface AtOfferCoupon {
  coupon_code?: string;
  coupon_desc?: string;
}

export interface AtOffer {
  id: string;
  merchant: string;
  domain: string;
  content: string;
  name?: string;
  coupons?: AtOfferCoupon[];
  aff_link: string;
  end_time?: string; // "YYYY-MM-DD"
  start_time?: string;
}

export interface AtTopProduct {
  product_id: string;
  merchant: string;
  rank?: number;
  order_count?: number;
}

interface Paged<T> {
  data: T[];
  total?: number;
  page?: number;
}

export class AccessTradeAdapter {
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly token: string) {}

  /** Serialize + throttle all outgoing requests (never bursts past the limit). */
  private async throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    });
    // Keep the chain alive even if a request fails.
    this.queue = run.catch(() => undefined);
    await run;
    return fn();
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    for (let attempt = 0; ; attempt++) {
      const res = await this.throttled(() =>
        fetch(url, { headers: { Authorization: `Token ${this.token}` } }),
      );
      if (res.ok) {
        // AccessTrade emits bare NaN for some numeric fields (seen live:
        // `"desc": NaN` in datafeeds), which is invalid JSON. Null them out.
        const raw = await res.text();
        return JSON.parse(raw.replace(/(:\s*)NaN\b/g, "$1null")) as T;
      }

      const body = await res.text();
      const isRateLimit = res.status === 400 && /rate ?limit/i.test(body);
      if (isRateLimit && attempt < MAX_RETRIES) {
        // Exponential backoff with jitter: 4s, 8s, 16s, ...
        const delay = 4000 * 2 ** attempt + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`AccessTrade ${path} failed: ${res.status} ${body.slice(0, 300)}`);
    }
  }

  /**
   * All campaigns, following pagination. The API returns `total_page`, and
   * approved campaigns are spread across pages — reading only page 1 silently
   * under-reports approvals.
   */
  async campaigns(): Promise<AtCampaign[]> {
    const all: AtCampaign[] = [];
    let totalPages = 1;
    for (let page = 1; page <= totalPages && page <= 20; page++) {
      const res = await this.request<Paged<AtCampaign> & { total_page?: number }>(
        "/campaigns",
        { page, limit: 50 },
      );
      all.push(...(res.data ?? []));
      if (res.total_page) totalPages = res.total_page;
      if ((res.data ?? []).length === 0) break;
    }
    return all;
  }

  /** One page of the datafeed for a domain (+optional category). */
  async datafeed(domain: string, cat?: string, page = 1, limit = 100): Promise<Paged<AtDatafeedItem>> {
    return this.request<Paged<AtDatafeedItem>>("/datafeeds", { domain, cat, page, limit });
  }

  /** Voucher/offer information (covers vouchers per D6). */
  async offers(merchant?: string, page = 1, limit = 100): Promise<Paged<AtOffer>> {
    return this.request<Paged<AtOffer>>("/offers_informations", { merchant, page, limit });
  }

  /** Top products (sales-volume quality proxy). date range required by API. */
  async topProducts(dateFrom: string, dateTo: string, page = 1, limit = 100): Promise<Paged<AtTopProduct>> {
    return this.request<Paged<AtTopProduct>>("/top_products", {
      date_from: dateFrom,
      date_to: dateTo,
      page,
      limit,
    });
  }
}

let singleton: AccessTradeAdapter | null = null;
export function getAccessTrade(): AccessTradeAdapter {
  if (!singleton) {
    const token = process.env.ACCESSTRADE_TOKEN;
    if (!token) throw new Error("Missing ACCESSTRADE_TOKEN");
    singleton = new AccessTradeAdapter(token);
  }
  return singleton;
}
