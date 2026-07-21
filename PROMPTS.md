# Prompts (v2 — synced to PRD §13 decisions)

Two prompts. **Prompt A** drives a coding agent (Claude Code / Cursor) to build the system. **Prompt B** drives a UI generator for the chat interface. Paste `PRD.md` alongside if your tool supports attachments — the prompts assume its decisions (D1–D8, F10/F11).

---

## Prompt A — Code build (paste into Claude Code / Cursor)

> **Role.** You are a senior TypeScript engineer building a production feature. Favor clean, typed, maintainable code. Implement the specified logic fully — no stubs where behavior is defined. Put any assumption in a top-of-file comment.
>
> **What we're building.** An AI chat that turns a Vietnamese natural-language shopping request into a ranked shortlist of affiliate products + vouchers sourced from AccessTrade (accesstrade.vn), routing every click through our own tracked redirect. Full context in `PRD.md`; this prompt encodes its resolved decisions.
>
> **Stack (do not substitute).** Next.js App Router + TypeScript (chat UI + API routes), PostgreSQL + Prisma, Redis, Typesense, Claude API for intent parsing, n8n for ingestion orchestration. Tailwind for styling.
>
> **Invariants — not suggestions:**
> 1. **Never query AccessTrade on the request path.** `/v1/datafeeds` has no free-text search and is rate-limited (~30 req/min). Ingest into Postgres on a schedule, index into Typesense, and have the chat search Typesense only.
> 2. **Never expose a raw `aff_link` to the client.** Cards link to internal `/go/[id]`. That route resolves the destination from the server store by id (404 on unknown id — never take the destination from the query string), and 302s to the `aff_link`.
> 3. **`/go` attribution contract (per D1 / F10 / F11):**
>    - Generate a `clickId` per hit. Write a `ClickEvent` (fire-and-forget) and set the attribution cookie with `maxAge` re-armed every hit.
>    - Also append `clickId` to the outbound URL as a query param — a webview-resilient first-party record that survives cookie-stripping (in-app browsers routinely strip third-party cookies; this is the median path for TikTok/IG traffic).
>    - Detect in-app webviews by UA and record an `isWebview` flag on the event. In v1 still route through the AccessTrade `aff_link` (their server-side commission tracking survives webviews); do NOT hand-build native deeplinks — gate that on real completion data first.
>    - Emit a redirect-completion signal so webview/handoff drop-off is measurable, not assumed.
>    - `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Outbound CTAs use a plain `<a target="_blank" rel="nofollow sponsored noopener">`, never `next/link` (prefetch would fire the redirect).
>    - NOTE (v1.5 dependency, do not build now): joining to AccessTrade's *paid* conversions will require stamping `clickId` as a sub-id via the create-link endpoint. The passthrough above only gives us first-party click truth, not paid-conversion reconciliation.
> 4. **Intent parsing returns strict JSON only** — no markdown, no prose. Validate with zod; on parse failure, degrade to keyword-only search.
> 5. **No ratings.** Quality is a sales-volume proxy from `/v1/top_products`. Keep a nullable `rating` column for later backfill. Never render stars or imply a rating exists — "phổ biến"/popular is the strongest allowed quality claim.
> 6. **Ingestion is orchestrated by n8n but computed in our code.** All logic lives behind secret-guarded `/api/internal/ingest/[job]` routes; n8n only schedules and sequences by calling them. Keep ingestion logic testable and in-repo, never in the workflow GUI.
> 7. Show an affiliate disclosure with every result set, plus a lightweight PDPL cookie/consent notice (see step 8).
>
> **Assume these modules already exist** (build around them; regenerate only if missing):
> - `lib/affiliate/accesstrade.ts` — `AccessTradeAdapter` (`datafeed()`, `offers()`, `topProducts()`; auth `Authorization: Token <token>`; internal throttle).
> - `lib/affiliate/ranking.ts` — `SearchIntent`, `Candidate`, `rank()` implementing `score = 0.45·priceScore + 0.35·voucherScore + 0.20·qualityScore` (weights in config; voucherScore saturating `1 − e^(−n/2)`; priceScore normalized within the result set).
>
> **Build, in this order:**
> 1. `prisma/schema.prisma` — `Product`, `Voucher`, `ClickEvent` per PRD §9 (prices as integer VND; `ClickEvent.clickId` unique, plus `isWebview` boolean and nullable `completedAt`). Generate the migration.
> 2. `lib/search/typesense.ts` — client + `products` collection (name, merchant, category, price, hasVoucher, salesRank, image, product ref). Diacritic + typo tolerance on `name`. `upsertProducts()`, `search(intent)` → `Candidate[]`.
> 3. `lib/ingest/accesstrade-ingest.ts` — throttled jobs: `ingestProducts(domain, cat?)`, `ingestVouchers(merchant?)` (uses `offers()` — the dedicated vouchers endpoint and create-link are NOT needed for v1, per D6), `ingestTopSellers()`. **Gate the index to approved campaigns only:** fetch `/v1/campaigns` and include only `affiliationStatus === "APPROVED"` (D2). Upsert to Postgres, then sync Typesense. Retry AccessTrade `400 "rate limit"` with backoff. Full catalog refresh sourced from the static CSV datafeed (bulk, avoids the 30/min ceiling); vouchers via API (D3).
> 4. `app/api/internal/ingest/[job]/route.ts` — secret-guarded entrypoints the n8n nodes call. Jobs: `products-nightly`, `vouchers-6h`, `top-sellers`. Idempotent.
> 5. `lib/intent/parse.ts` — Claude API call whose system prompt emits **only** a JSON object matching `SearchIntent`. Include the exact system prompt inline. zod-validate; degrade to `{ keywords: tokenize(prompt) }` on failure.
> 6. `app/api/chat/route.ts` — `POST { prompt, campaign? }` → parse intent → Typesense search → join active (non-expired) vouchers + salesRank → `rank()` → `{ reply, results }`, each result carrying a `/go/{id}` href. **Never include `affLink` in the response.** **No-match cascade (D7):** exact intent → relax price ceiling → widen to category → suggest 1–2 adjacent categories, each step labeled honestly; never return an empty dead-end.
> 7. `app/go/[id]/route.ts` — the tracked redirect per invariant 3.
> 8. Consent + disclosure (D5): a lightweight, dismissable cookie/consent notice (Vietnam PDPL / Law 91/2025 + Decree 356 — consent-centric, verifiable). Keep IP hashed, log no raw PII. Affiliate disclosure under every result set.
> 9. Chat UI per **Prompt B** (or a functional placeholder if building headless first).
> 10. A `evals/ranking-smoke.ts` — ~25 hand-labeled VN queries asserting sane top-result ordering (D4). Ship the default weights; this only catches gross regressions, it is not tuning.
>
> **Acceptance criteria:**
> - `POST /api/chat` with a VN prompt returns ranked results; response body contains zero `aff_link` strings.
> - `/go/<validId>` sets the cookie, appends `clickId` to the outbound URL, records the event (with `isWebview`), and 302s; `/go/<garbage>` → 404.
> - Ingestion never bursts > 30 req/min, is idempotent, and indexes only `APPROVED` campaigns.
> - Intent parser returns valid `SearchIntent` for 5 sample VN prompts and never throws on malformed model output.
> - No-match input still returns a labeled broadened result set, never empty.
> - Consent notice present; no raw IP or PII in logs.
> - Typecheck + lint pass; no `any` on public signatures.
>
> Ask before adding any dependency not implied above. On completion, output a run guide (env vars, migrate, seed Shopee, wire the three n8n schedules, start).
>
> **If using Postgres FTS instead of Typesense:** replace step 2 with a `tsvector + unaccent` module; drop the Typesense dependency; everything else holds.

---

## Prompt B — Chat UI design (paste into your UI generator / design tool)

> Design a mobile-first chat interface for a Vietnamese affiliate deal-finder. One job: the user types a product need, gets back a ranked shortlist of buyable cards. Next.js + Tailwind.
>
> **Layout.** A calm conversation column. User bubbles right, assistant left. An assistant response is a short VN line ("Đây là vài lựa chọn tốt nhất") followed by a horizontally-scrollable row (mobile) / responsive grid (desktop) of product cards. Input pinned bottom with a send affordance and 3–4 tappable example prompts above it for cold-start.
>
> **Product card.** Square image; platform badge whose color *is* the marketplace (Shopee `#EE4D2D`, TikTok Shop near-black `#111114`, Lazada `#0F146D` — color carries which marketplace, so keep the rest neutral); name (2-line clamp); bold price with optional strikethrough original; voucher chips ("Giảm 50K", "Freeship") when present; primary CTA "Xem deal trên {platform}" opening in a new tab. Cards with more/better vouchers feel slightly more prominent — a subtle ribbon, not a redesign.
>
> **Signature.** A discreet "best pick" tag on the top-ranked card — earned by score, not decoration.
>
> **States.** Empty: welcoming line + example prompts. Loading: skeleton cards, not a spinner. **No exact match: show the broadened results with an honest label** ("Không có đúng tầm giá đó — đây là gần nhất") — never a dead-end, never an apology. Error: plain, actionable.
>
> **Required.** Affiliate disclosure beneath every result set. A lightweight, dismissable cookie/consent notice (VN PDPL). Keyboard-navigable, visible focus, respects reduced motion, touch targets ≥ 44px.
>
> **Voice.** Vietnamese, conversational, plain verbs, sentence case, no filler. Buttons say exactly what happens.
>
> **Avoid** the generic AI-affiliate look: no cream-and-terracotta template, no fake urgency timers, and **no star ratings — we have no rating data; "phổ biến"/popular is the strongest quality claim allowed.**
