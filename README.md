# Deal Finder Chat (Tìm deal)

Mobile-first chat app for finding affiliate deals on Vietnamese marketplaces. Type a product need in Vietnamese (e.g. *"tai nghe bluetooth chống ồn dưới 1 triệu"*) and get a ranked shortlist of buyable product cards with cloaked affiliate links.

Product data comes from the AccessTrade affiliate network (Shopee plus brand-electronics merchants like CellphoneS, Thế Giới Di Động, Điện Máy Xanh), ingested on a schedule into Postgres and indexed in Typesense. Claude parses each chat prompt into a structured intent (category, budget, attributes) that drives search and ranking.

## Tech stack

- **Next.js 15** (App Router) + React 19 + Tailwind CSS 4
- **Postgres** via Prisma — canonical product/voucher/click storage
- **Typesense** — product search index
- **Claude API** (`@anthropic-ai/sdk`) — intent parsing
- **n8n** — schedules the ingest jobs (all logic lives in this repo; n8n only fires HTTP requests)

## How it works

1. **Ingest** — `POST /api/internal/ingest/{job}` endpoints (secured by `x-ingest-secret`) pull AccessTrade datafeeds per merchant domain, upsert into Postgres, and sync to Typesense. Jobs: `products-nightly`, `vouchers-6h`, `top-sellers`.
2. **Chat** — `POST /api/chat` parses the prompt into intent with Claude, queries Typesense, and returns ranked results. Responses never expose raw `aff_link` URLs — only `/go/{id}` hrefs.
3. **Redirect** — `GET /go/{id}` 302s to the affiliate URL, setting a `df_click` cookie and appending a `dfclid` click id (IPs are salted-hashed; no raw PII stored).

## Quick start

Requires Node 22+, Docker (for local Postgres + Typesense), an Anthropic API key, and an AccessTrade publisher token with at least one approved campaign.

```sh
# 1. Services
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=deal_finder -p 5432:5432 postgres:16
docker run -d --name ts -p 8108:8108 -v ts-data:/data typesense/typesense:27.1 --data-dir /data --api-key=xyz

# 2. Configure
# Copy .env.example → .env and fill in the vars (see RUN.md for the full table)

# 3. Install + migrate
npm install
npx prisma migrate deploy
npx prisma generate

# 4. Run
npm run dev
```

Then trigger a first ingest — see [RUN.md](RUN.md) for the exact curl commands, merchant domains, approval prerequisites, and the n8n cron schedule table.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build && npm start` | Dev / production server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run eval:ranking` | Ranking smoke eval (25 cases) |
| `npm run test:e2e` | Playwright end-to-end tests |

## Project layout

```text
app/api/chat/            Chat endpoint (intent → search → ranked results)
app/api/internal/ingest/ Ingest jobs (products, vouchers, top sellers)
app/go/                  Affiliate redirect with click tracking
components/              Chat UI, product cards, promo banner, consent notice
lib/affiliate/           AccessTrade client + ranking
lib/ingest/              Feed ingestion pipeline
lib/intent/              Claude-based intent parsing
lib/search/              Typesense client
lib/tracking/            Click/webview tracking
prisma/                  Schema + migrations
evals/                   Ranking smoke eval
e2e/                     Playwright specs
```

## Docs

- [RUN.md](RUN.md) — full run guide: env vars, ingest jobs, n8n schedules, verification checks
- [PRD.md](PRD.md) — product requirements
- [DESIGN.md](DESIGN.md) — design system (brand, color, components)
- [PROMPTS.md](PROMPTS.md) — prompt documentation
