# Run Guide

## 1. Env vars

Copy `.env.example` → `.env` and fill:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `TYPESENSE_HOST/PORT/PROTOCOL/API_KEY` | Typesense node |
| `ANTHROPIC_API_KEY` | Claude API for intent parsing (`INTENT_MODEL` defaults to `claude-opus-4-8`) |
| `ACCESSTRADE_TOKEN` | AccessTrade API token (`Authorization: Token …`) |
| `ACCESSTRADE_CSV_URL` | **Optional — leave empty.** The `/v1/datafeeds` API is the working default (verified: ~12.9k Shopee products). AccessTrade's UI does not reliably expose a CSV export link; set this only if you find one for your campaign |
| `INGEST_SECRET` | Shared secret; n8n sends it as `x-ingest-secret` |
| `IP_HASH_SALT` | Salt for IP hashing in ClickEvent (no raw PII) |
| `REDIS_URL` | Reserved for v1.5 intent caching — no v1 code consumes it (redis client dep deliberately not added yet) |

Local services (example):

```sh
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=deal_finder -p 5432:5432 postgres:16
docker run -d --name ts -p 8108:8108 -v ts-data:/data typesense/typesense:27.1 --data-dir /data --api-key=xyz
```

## 2. Migrate + generate

```sh
npm install
npx prisma migrate deploy   # applies prisma/migrations/20260719000000_init
npx prisma generate
```

## 3. First ingest (all approved merchant feeds)

Prerequisite (D2): the campaign must be approved for your publisher account.
The API reports this as `approval: "successful"` on `/v1/campaigns` (**not**
`affiliationStatus: "APPROVED"` — that field does not exist). Unapproved
merchants are filtered out of the index entirely. If *no* campaign is approved
the ingest job now fails loudly rather than silently indexing zero rows.

Check your approvals:

```sh
curl -s -H "Authorization: Token $ACCESSTRADE_TOKEN" \
  "https://api.accesstrade.vn/v1/campaigns?page=1&limit=50" \
  | grep -o '"merchant": "[^"]*"' | head
```

Then run the jobs (verified live against a real Shopee campaign):

```sh
npm run dev   # or build && start

# Vouchers first, so products get an accurate hasVoucher flag.
# ~4 min, ingested 4,488 real Shopee vouchers.
curl -X POST http://localhost:3000/api/internal/ingest/vouchers-6h \
  -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"merchant":"shopee"}'

# Products: pages the throttled API (~28 req/min), so a full 12.9k-product
# catalog takes a while. Safe to re-run — upserts are idempotent.
# One call per merchant domain; run it for every approved feed you want
# indexed (verified live: shopee.vn, hoanghamobile.com, cellphones.com.vn,
# thegioididong.com, dienmayxanh.com — Shopee alone has no brand electronics).
for domain in shopee.vn hoanghamobile.com cellphones.com.vn thegioididong.com dienmayxanh.com; do
  curl -X POST http://localhost:3000/api/internal/ingest/products-nightly \
    -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" \
    -d "{\"domain\":\"$domain\"}"
done

# Top sellers: fills salesRank AND re-syncs Postgres → Typesense.
# Returns processed:0 until the account has conversion history — that is normal.
curl -X POST http://localhost:3000/api/internal/ingest/top-sellers \
  -H "x-ingest-secret: $INGEST_SECRET" -d '{}'
```

## 4. Wire the three n8n schedules

Each workflow is just: **Schedule Trigger → HTTP Request** (POST, header `x-ingest-secret`). All logic is in-repo; n8n only schedules (invariant 6).

One products workflow per ingested domain (all are approved campaigns on this
account). Staggered 15 min apart: the AccessTrade rate limit (~30 req/min) is
per token, and a full feed takes ~5 min at the adapter's throttle, so
back-to-back slots must not overlap.

| Workflow | Cron | URL | Body |
|---|---|---|---|
| Products: Shopee | `0 2 * * *` | `/api/internal/ingest/products-nightly` | `{"domain":"shopee.vn"}` |
| Products: Hoàng Hà Mobile | `15 2 * * *` | `/api/internal/ingest/products-nightly` | `{"domain":"hoanghamobile.com"}` |
| Products: CellphoneS | `30 2 * * *` | `/api/internal/ingest/products-nightly` | `{"domain":"cellphones.com.vn"}` |
| Products: Thế Giới Di Động | `45 2 * * *` | `/api/internal/ingest/products-nightly` | `{"domain":"thegioididong.com"}` |
| Products: Điện Máy Xanh | `0 3 * * *` | `/api/internal/ingest/products-nightly` | `{"domain":"dienmayxanh.com"}` |
| Vouchers 6h | `0 */6 * * *` | `/api/internal/ingest/vouchers-6h` | `{}` |
| Top sellers | `30 3 * * *` | `/api/internal/ingest/top-sellers` | `{}` (run after products) |

To add/remove a merchant later, add/remove a products row here — nothing else
changes (the job only indexes approved campaigns, so an unapproved domain
ingests zero rows and fails loud).

Note: `MAX_API_PAGES` in `lib/ingest/accesstrade-ingest.ts` bounds a run at
150 pages ≈ 15k products; dienmayxanh.com (~17.4k) is truncated to the first
15k. Raise the bound if a feed grows past it.

Turn on n8n error notifications — a non-2xx response means the job failed loud (R13 freshness alarm).

## 5. Start

```sh
npm run dev          # local
npm run build && npm start   # production
```

Checks:

- `POST /api/chat {"prompt":"tai nghe bluetooth chống ồn dưới 1 triệu"}` → ranked `results` with `/go/{id}` hrefs, zero `aff_link` strings.
- `GET /go/<valid id>` → 302 with `df_click` cookie + `?dfclid=` on the outbound URL; `GET /go/garbage` → 404.
- `npm run typecheck`, `npm run lint`, `npm run eval:ranking` (25/25).
