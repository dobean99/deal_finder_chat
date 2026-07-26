# PRD — Deal Finder Chat (working title)

An AI chat that turns a natural-language request ("tai nghe bluetooth chống ồn dưới 1 triệu") into a ranked shortlist of affiliate products and vouchers sourced from AccessTrade, ordered by best price, most vouchers, and highest quality signal. Every recommendation routes through our own tracked redirect so attribution stays ours.

**Owner:** Bean · **Status:** Draft v1 · **Stack:** Next.js (chat UI) · Fastify/TypeScript (services) · PostgreSQL + Prisma · Redis · Typesense · n8n (ingestion) · Claude API (intent parsing)

---

## 1. Problem & goal

Affiliate shoppers in VN/SEA compare the same product across Shopee, TikTok Shop, and Lazada manually, and miss stacked vouchers. Existing affiliate sites are static link lists with no query understanding and no cross-platform price/voucher comparison.

**Goal:** a conversational finder that answers "what should I buy for X and where" with a ranked, voucher-aware shortlist — and captures the click on our attribution layer, which is the durable advantage over generic affiliate sites.

**Non-goal (v1):** checkout, cart, price-history charts, user accounts, multi-turn memory beyond the current session.

---

## 2. Target user & primary use case

A price-sensitive VN shopper arriving from social (TikTok/IG bio link) with buying intent. They type or tap a product need in Vietnamese; they expect 3–8 ranked options with price, visible vouchers, and a one-tap "buy on {platform}" that lands them on the real product page with our affiliate tracking intact.

---

## 3. The constraints that shape the design (non-negotiable context)

These come from how AccessTrade actually works and must be respected by the implementation:

1. **AccessTrade is a feed, not a search API.** `GET /v1/datafeeds` filters only by `domain` + `cat`. There is no free-text query endpoint, and the API is rate-limited (~30 req/min). Therefore the chat **must not** query AccessTrade live. We ingest feeds on a schedule into Postgres, index into Typesense, and the chat searches our index.
2. **AccessTrade feeds carry no ratings.** Quality in v1 is a **sales-volume proxy** derived from `/v1/top_products`. The schema reserves a nullable `rating` column to backfill from Shopee/Lazada Open Platform APIs later (those require separate approval — treat as a future enrichment, not a v1 dependency).
3. **Attribution is ours to lose.** Feed rows include `aff_link` (already an AccessTrade deeplink). We never expose it directly. Cards point at an internal `/go/[id]` redirect that logs the click, (re-)arms the attribution cookie, and 302s to the `aff_link`. Re-arming the cookie `maxAge` on every hit is the deliberate fix for cross-platform window expiry.

---

## 4. Scope

**In (v1):** single-turn chat; VN-language intent parsing; Typesense-backed search over ingested products; composite ranking; result cards with price + voucher chips + platform badge; tracked redirect **with webview detection + native deeplink preference and redirect-completion instrumentation (F10)**; durable `clickId` groundwork for reconciliation (F11); scheduled ingestion (products, vouchers, top-sellers); basic click logging.

**v1.5 (scheduled, not deferred indefinitely):** conversion-webhook reconciliation consumer that resolves the F11 `clickId` join into paid/rejected outcomes — this is what turns the estimated revenue metric into a real one.

**Out (v1):** real star ratings, personalization/accounts, admin dashboard, A/B weight tuning UI.

---

## 5. Functional requirements

| # | Requirement |
|---|---|
| F1 | Chat accepts a free-text prompt (VN default) and returns a ranked shortlist of 3–8 items. |
| F2 | An intent parser converts the prompt into a strict-JSON `SearchIntent` (keywords, category, brand, priceMin/Max, mustHaveVoucher). No prose in the model output. |
| F3 | Search queries the Typesense index using parsed intent; typo-tolerant, diacritic-insensitive, faceted by merchant/price/hasVoucher. |
| F4 | Each candidate is joined to active vouchers (by merchant/domain, excluding expired) and a quality proxy, then ranked by the composite score (see §7). |
| F5 | Results render as cards: image, name, price (+ strikethrough original), platform badge, voucher chips, "View deal on {platform}" CTA → `/go/[id]`. |
| F6 | `/go/[id]` logs the click, sets/refreshes the attribution cookie, and 302s to the config-resolved `aff_link`. Unknown id → 404. Destination is never taken from the query string. |
| F8 | Ingestion jobs (n8n) pull datafeeds, offers, and top-sellers on a schedule, upserting into Postgres and re-indexing Typesense, within the rate limit. |
| F9 | Empty/failed search returns a helpful, actionable message in the interface voice (not an apology, not a stack trace). |
| F10 | `/go/[id]` detects in-app webviews (UA-based) and prefers a platform deeplink / universal link into the native app where platform tracking survives, falling back to the web `aff_link` otherwise. It emits a redirect-completion signal so webview drop-off is measurable, not assumed. (See R1.) |
| F11 | Every click writes a durable `clickId` (cookie + `ClickEvent`) as the join key for conversion-webhook reconciliation. The reconciliation consumer itself is v1.5, but the join key and schema ship in v1 so no attributed clicks are lost before it lands. (See R2.) |

---

## 6. Non-functional requirements

- **Latency:** chat response < 1.5s p95 (intent parse + index query + rank). No synchronous AccessTrade call on the request path.
- **Rate-limit safety:** ingestion throttled to stay under 30 req/min; 400 "rate limit" responses retried with backoff.
- **Attribution integrity:** no raw `aff_link` in client HTML; outbound CTAs use a plain `<a>` (never `next/link`) to avoid prefetch inflating clicks; redirect route is `runtime='nodejs'` + `force-dynamic`. Redirect completion is instrumented so webview/deeplink failure (R1) is observable, and click-attribution numbers are reported as an estimate until reconciliation (R2) lands.
- **Security:** redirect target resolved from server store by id only (no open redirect); IP hashed before logging; secrets in env.
- **Compliance:** treat recommendations as incentivized traffic under each platform's terms; keep AI-content labeling in mind for any generated copy surfaced to users.
- **Accessibility:** keyboard-navigable results, visible focus, reduced-motion respected, mobile-first.

---

## 7. Ranking spec

Per candidate, each term normalized to 0–1, weights in config:

```
score = 0.45 · priceScore      # (maxPrice − price)/(maxPrice − minPrice) within the result set
      + 0.35 · voucherScore    # 1 − e^(−voucherCount/2)   (saturating)
      + 0.20 · qualityScore    # top-seller rank proxy now; real rating later
```

Weights are tunable and must not be hardcoded in call sites. Post-v1, tune against `/go` click-through — that feedback loop is the real long-term ranker.

---

## 8. System architecture

```
n8n (cron) → AccessTradeAdapter → Postgres (products, vouchers, top_sellers)
              /v1/datafeeds            │
              /v1/offers_informations  └→ Typesense index (products)
              /v1/top_products
                                            ▲
 user prompt → Claude API (intent→JSON) → chat API → search+rank → cards
                                                          │
                                          card CTA → /go/[id] → aff_link → merchant
                                                          │
                                          (future) conversion webhook → join by clickId
```

Wrap AccessTrade behind the existing `AffiliateAdapter` pattern so a second network (or platform Open APIs) slots in without touching the chat/ranking layers.

---

## 9. Data model (Prisma sketch)

```prisma
model Product {
  id           String   @id @default(cuid())
  productId    String   // AccessTrade product_id
  merchant     String   // shopee | lazada | tiktokshop
  domain       String
  name         String
  price        Int      // store as integer VND
  originalPrice Int?
  image        String?
  category     String?
  affLink      String   // AccessTrade deeplink (never sent to client raw)
  salesRank    Int?     // from top_products; feeds quality proxy
  rating       Float?   // reserved; backfilled from platform APIs later
  updatedAt    DateTime @updatedAt
  vouchers     Voucher[]
  @@unique([merchant, productId])
  @@index([merchant, category])
}

model Voucher {
  id         String   @id @default(cuid())
  merchant   String
  domain     String
  content    String
  code       String?
  affLink    String
  endTime    DateTime?
  productId  String?
  product    Product? @relation(fields: [productId], references: [id])
  @@index([merchant, endTime])
}

model ClickEvent {
  id         String   @id @default(cuid())
  clickId    String   @unique   // cookie ↔ conversion join key
  productId  String
  merchant   String
  campaign   String?
  ipHash     String?
  ua         String?
  createdAt  DateTime @default(now())
  @@index([productId, createdAt])
}
```

---

## 10. API surface

- `POST /api/chat` → `{ prompt, campaign? }` → `{ reply, results: Card[] }`. Parses intent, searches, ranks, returns cards (each with a `/go/{id}` href, never a raw affLink).
- `GET /go/[id]?c=<campaign>` → logs, sets cookie, 302 to affLink. (Already specified in the storefront work.)
- Internal: ingestion jobs invoked by n8n hitting a secured `/internal/ingest/*` or run as workers.

---

## 11. Success metrics

- **Primary:** affiliate click-through rate per chat session (`/go` hits ÷ sessions).
- **Secondary:** search success rate (non-empty result sets ÷ queries); median results returned; voucher-attach rate (share of shown cards with ≥1 voucher).
- **North star (post-webhook):** attributed conversions per 100 sessions.

> Caveat: until v1.5 reconciliation (F11) lands, any conversion/revenue figure is an internal estimate that skews optimistic (R2). Report it as such. Also watch redirect-completion rate (F10) as a leading indicator — a healthy click count with a low completion rate means the webview problem is eating your revenue upstream of any conversion metric.

---

## 12. Milestones

1. **Foundation:** Prisma schema + AccessTradeAdapter (done) + throttled ingestion for one merchant (Shopee) into Postgres.
2. **Index & search:** Typesense sync + faceted query; verify diacritic/typo tolerance on VN queries.
3. **Chat loop:** intent parser (Claude API, strict JSON) → search → rank → cards → `/go` **with webview detection + native deeplink preference + completion instrumentation (F10)**.
4. **Vouchers & quality:** join offers, apply saturating voucher score, wire top-sellers proxy.
5. **Polish:** empty/error states, mobile, accessibility. Expand to Lazada + TikTok Shop feeds.
6. **v1.5:** conversion-webhook reconciliation (F11) — turn estimated revenue into real revenue.
7. **Post-v1:** real ratings via platform APIs; weight tuning from click-through.

---

## 13. Risks & open questions

These are the risks specific to how AccessTrade and SEA social traffic behave, not generic project risk. The first three are easy to miss and can quietly break the economics while the product looks healthy in our own logs.

### 13.1 The three that bite hardest

**R1 — In-app webviews silently break attribution.** Traffic arrives from TikTok/IG bio links, so most of it opens inside the app's embedded browser, not Chrome/Safari. Those webviews frequently strip third-party cookies, mangle multi-hop redirects, and fail to hand off to the native Shopee/Lazada app. The `/go → aff_link → merchant` chain — the entire reason we route clicks through our own layer — can therefore fail for the *majority* of real users while looking fine in our logs. This is the median path in VN/SEA, not an edge case. It is promoted to a functional requirement (F10) because it changes what `/go` must do: detect webview UA, prefer platform deeplinks/universal links into the native app where the platform's own tracking survives, and instrument redirect completion so the drop-off is visible rather than assumed.

**R2 — "Attributed" in our DB ≠ "paid" by the platform.** We re-arm *our* cookie window on every click but cannot extend the *platform's* window. A click today → purchase in 10 days → 7-day platform window means no commission, even though our `ClickEvent`/cookie reads as attributed. For all of v1, without conversion-webhook reconciliation, our revenue metric is an estimate that skews optimistic. Reconciliation is promoted from "post-v1 nice-to-have" to a scheduled v1.5 requirement (F11) with the `clickId` join key laid down now.

**R3 — "Best price" is unverifiable with a stale, partial feed.** Two compounding gaps: *freshness* (prices/vouchers drift between ingestion runs; 30 req/min fights fast refresh on a large catalog) and *coverage* (AccessTrade doesn't carry every SKU across all three platforms). "Best price" can be wrong two ways — the price moved, or a cheaper off-feed option exists. Beyond trust erosion, an unverifiable "rẻ nhất" claim is real exposure under VN advertising/consumer-protection rules. Copy must be softened to what's defensible ("giá tốt trong các lựa chọn tìm thấy"), and price treated as a display-time-verifiable field, not a promise.

### 13.2 Fuller register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R4 | Feed staleness (price/voucher drift) | High | High | Tiered ingest: CSV bulk for coverage + API for deltas; show "updated at"; verify price at click where feasible |
| R5 | Feed coverage gaps → empty results | High | Med | Graceful category-broaden fallback, never a dead-end; track search-success rate |
| R6 | Dead / expired `aff_link` in feed | Med | High | Periodic link-health check; drop or reindex on 404; alert |
| R7 | Surfacing non-approved campaigns → clicks don't track | Med | High | Filter index to approved campaign IDs only; reconcile against the campaign list |
| R8 | Single-network concentration (AccessTrade API/terms/rate change) | Med | High | `AffiliateAdapter` abstraction is the hedge; keep a second-network shim ready |
| R9 | LLM intent cost + latency at volume | Med | Med | Fast/cheap model, cache common intents, rules-based fast path for simple queries |
| R10 | Cold-start ranking weights unvalidated | High | Med | Ship 0.45/0.35/0.20 as a hypothesis; hand-tune on a seed eval set; log for later tuning |
| R11 | Sales-proxy presented as "quality" misleads users | Med | Med | Copy says "phổ biến"/popular, never rating/stars, until real ratings land |
| R12 | PDPD (VN data law) + cookie consent for click logging | Med | High | Lawful-basis review; consent for non-essential cookies; keep IP hashed; decide before launch |
| R13 | Ingestion job fails silently → stale index | Med | High | Heartbeat + freshness alarm on last-successful-run; fail loud |
| R14 | Typesense ↔ Postgres drift → phantom/missing products | Low | Med | Idempotent sync; periodic reconcile job; Postgres is source of truth |
| R15 | Prompt injection via user input into parser | Low | Low | Parser only emits `SearchIntent`; validate with zod; ignore anything else |
| R16 | Voucher/create-link endpoint paths differ by account/region | Med | Med | Confirm exact paths in developers.accesstrade.vn before ingestion; never ship guessed paths |
| R17 | ToS on incentivized traffic varies per platform, affects commission | Med | Med | Keep the adapter/compliance boundary explicit; per-platform rules encoded, not assumed |

### 13.3 Decisions

Resolved calls on the open questions. Two depend on account state and carry an action for the owner.

- **D1 — Webview (R1):** Do not rebuild AccessTrade's app handoff. Route through their `aff_link` (server-side commission tracking survives webviews); pass `clickId` as a **query param through `/go`, not cookie-only**, so our reconciliation survives cookie-stripping; instrument redirect completion. Build custom native deeplinks only if completion data shows AccessTrade's handoff failing.
- **D2 — Approved campaigns (action required):** Launch on **Shopee first**. Gate the index to `affiliationStatus === "APPROVED"` campaigns via `/v1/campaigns`. Owner to verify current approvals at `pub.accesstrade.vn/accounts`; if none, approval latency — not code — is the critical path. Apply immediately.
- **D3 — Staleness:** Nightly full refresh via static CSV datafeed (bulk, avoids the 30/min limit) + vouchers every 6h via API. Freshness SLA: prices ≤24h, vouchers ≤6h. Click-time price re-verify deferred to v1.5.
- **D4 — Ranking cold-start:** Ship `0.45/0.35/0.20` as a hypothesis; validate against a ~25-query hand-labeled smoke set pre-launch; real tuning waits for `/go` click-through data.
- **D5 — Consent (R12, updated):** Vietnam's Decree 13 is superseded — as of 1 Jan 2026 the framework is the **PDPL (Law 91/2025/QH15) + Decree 356/2025/ND-CP**, consent-centric with verifiable-consent and evidence requirements, extraterritorial scope, an outright ban on buying/selling personal data, and fines reaching a share of revenue. Ship a lightweight cookie/consent notice, acknowledge attribution/analytics cookies explicitly, keep IP hashed, log no raw PII, publish a privacy policy. VN counsel review before scaling. (Not legal advice.)
- **D6 — Endpoint paths:** Resolved for v1 — `offers_informations` covers vouchers and datafeed rows already carry `aff_link`, so the dedicated vouchers and create-tracking-link endpoints are unnecessary. Revisit only for off-feed link generation.
- **D7 — No-match:** Broaden, never dead-end. Cascade exact → relax price ceiling → category → 1–2 adjacent categories, each step honestly labeled. Intent + zero results is a lost click.
- **D8 — Second network:** Single-source on AccessTrade for v1. The `AffiliateAdapter` seam is the concentration hedge; exercise it when AccessTrade limits bite or a second network unlocks coverage — not before the core loop is validated.
