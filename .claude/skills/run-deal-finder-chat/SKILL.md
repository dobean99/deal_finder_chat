---
name: run-deal-finder-chat
description: Run, start, seed, and smoke-test the Deal Finder chat app locally on this Windows machine — launch the Next.js dev server, provision Postgres/Typesense, seed fake Shopee data, and drive /api/chat + /go with the committed smoke driver.
---

# Run: deal-finder-chat

Next.js (App Router) chat app: VN prompt → intent parse → Typesense search →
ranked cards → `/go/[id]` tracked redirect. Driven programmatically with the
committed **smoke driver** (`smoke.ts`) — no browser needed. All paths below
are relative to the repo root; all commands were verified on this machine
(Windows, Git Bash, local PostgreSQL 17, Docker inside WSL Ubuntu).

## Prerequisites (this machine)

- **PostgreSQL 17** runs natively on Windows, port 5432, user/pass
  `postgres`/`postgres`. Binaries: `C:/Program Files/PostgreSQL/17/bin`.
- **Typesense** runs as a Docker container **inside WSL Ubuntu** (no Docker on
  the Windows side). One-time create:

  ```bash
  wsl.exe -d Ubuntu -- bash -lc "docker run -d --restart unless-stopped --name ts-deal -p 8108:8108 -v ts-deal-data:/data typesense/typesense:27.1 --data-dir /data --api-key=xyz"
  ```

- **WSL keepalive (required):** the WSL VM shuts down when idle, taking Docker
  and Typesense with it. Hold it open for the session (run in background):

  ```bash
  wsl.exe -d Ubuntu -- bash -lc "sleep 1800"
  ```

  Then verify from Windows: `curl -s http://localhost:8108/health` → `{"ok":true}`.
  If the container is missing after a VM restart:
  `wsl.exe -d Ubuntu -- bash -lc "docker start ts-deal"`.

## Setup

```bash
npm install
# .env: copy .env.example; localhost values work. Chat degrades to keyword-only
# search without an intent key; set GEMINI_API_KEY (free tier) or
# ANTHROPIC_API_KEY to get price/category parsing.
npx prisma migrate deploy
npx prisma generate
```

Create the DB once if missing (password `postgres`):

```bash
PATH="/c/Program Files/PostgreSQL/17/bin:$PATH" PGPASSWORD=postgres createdb -U postgres -h localhost deal_finder
```

## Seed (no AccessTrade token needed)

```bash
npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/seed-dev.ts
```

Idempotent; inserts 8 fake Shopee products + 2 vouchers into Postgres and the
Typesense index. **Warning:** the fake products carry dead
`/deep_link/demo` affiliate links that 404 for real users — remove them once
real ingest data exists:

```bash
npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/unseed-dev.ts
npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/reindex.ts
```

`reindex.ts` drops the Typesense collection and rebuilds it from Postgres —
the authoritative fix for a stale index (orphaned docs, empty index, etc.);
prefer it over the `top-sellers` job when there's no live conversion data.

## Run (agent path)

Port **3100** — port 3000 is occupied by the trading-dashboard stack in WSL
(its 404 page will answer on 3000 and confuse you).

```bash
npx next dev -p 3100   # run in background; ready in ~10s
```

Then drive it end-to-end with the smoke driver (chat exact + no-match
cascade, /go 302 + cookie + utm_content clickId, 404, completion beacon, ClickEvent row
in the DB — 15 checks):

```bash
npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/smoke.ts
# BASE_URL=http://localhost:3100 is the default; override if needed
```

Expected: `smoke: ALL PASS`, exit 0.

Single manual probes, if you need them:

```bash
curl -s -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" \
  -d '{"prompt":"tai nghe bluetooth chống ồn dưới 1 triệu"}'
curl -s -D - -o /dev/null "http://localhost:3100/go/<id-from-chat-response>"
```

## Run (human path)

Open http://localhost:3100 in a browser — type a VN shopping prompt, cards
render, CTA opens the tracked redirect in a new tab.

## Test / checks

```bash
npm run typecheck && npm run lint && npm run eval:ranking   # eval: 25/25
```

## Gotchas

- **Port 3000 is taken** by `trading-statistic-dashboard` (WSL Docker,
  published to Windows localhost). `next dev` may even claim "Ready on 3000"
  while the WSL relay wins the traffic. Always use `-p 3100`.
- **WSL VM idles out between commands** — every `wsl.exe` invocation boots it
  fresh and containers come up seconds later. Without the keepalive above,
  Typesense health checks fail intermittently (curl exit 7) even though the
  container is configured with `--restart unless-stopped`.
- **Docker daemon restarts kill unlucky containers**: the first Typesense run
  died with `Exited (255)` when the trading-dashboard compose stack came up.
  `docker start ts-deal` fixes it.
- **`localhost` vs `127.0.0.1`**: reachability of the WSL port relay flapped
  during testing. If Node gets `ECONNREFUSED` on 8108/5432, first confirm the
  WSL VM is actually up (keepalive), then try switching host form in `.env`.
- **Empty intent key ≠ broken**: without `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`
  the parser silently degrades to keyword search — results appear but price
  ceilings ("dưới 1 triệu") aren't applied. With Gemini configured the same
  query returns fewer, correctly price-filtered results.
- **Real ingest works** (verified 2026-07-19 against a live token): 4,488
  Shopee vouchers + real products, `/go` resolving to genuine
  `go.isclix.com/deep_link/…` URLs. The seed script is only for working
  without a token.
- **AccessTrade field names are not what the docs suggest.** Verified live:
  campaigns use `approval: "successful"` (not `affiliationStatus: "APPROVED"`);
  datafeed rows use `cate` (not `category`) and have **no list-price field** —
  `discount` is a 6–33₫ artifact and `discount_amount` is just
  `price - discount`, so `originalPrice` is intentionally left NULL. Offers
  nest codes in a `coupons[]` array. Re-verify with a raw `curl` before
  trusting any new field.
- **AccessTrade datafeeds can contain literal `NaN`** (`"desc": NaN`) —
  invalid JSON that killed `products-nightly` mid-run until
  `lib/affiliate/accesstrade.ts` started nulling it out before parsing.
  Verified full run after the fix: 5,000 products, 5,000 vouchers.
- **`ACCESSTRADE_CSV_URL` is a dead end** — the publisher UI does not reliably
  expose a CSV export. Leave it empty; the `/v1/datafeeds` API path works
  (~12.9k Shopee products).
- **Typesense can come back with no published port** after an unclean WSL
  shutdown: `docker port ts-deal` prints nothing and every connection is
  `ECONNREFUSED`, even though the container says `Up` and its logs show a
  healthy leader. `docker start` does **not** fix it — recreate the container
  (the named volume keeps the data). After recreating, `/health` returns
  `{"ok":false}` for a few seconds while it replays the WAL.
- **The ingest jobs outlive a 240s curl timeout.** The voucher job took ~4min;
  curl gives up first and prints nothing while the server still logs `200`.
  Check the dev-server log or the DB row count, not curl's output.
- **`top-sellers` doubles as the index repair job** — it re-syncs all of
  Postgres into Typesense, which is how you refill the index after dropping
  the collection.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `EPERM: operation not permitted, open '.next\trace'` on `next dev` | A previous dev-server node process still holds the file. Kill node processes whose command line matches `deal_finder_chat` (PowerShell `Get-CimInstance Win32_Process`), then `Remove-Item -Recurse -Force .next`. |
| `curl http://localhost:8108/health` exits 7 | WSL VM is down. Start the keepalive, wait ~5s, `docker start ts-deal`. |
| Typesense `ECONNREFUSED` but container shows `Up` | Port publish was lost. Check `wsl.exe -d Ubuntu -- bash -lc "docker port ts-deal"` — if empty, recreate: `docker rm -f ts-deal` then the `docker run` line from Prerequisites (volume preserves data). |
| `/api/chat` 500 with `ECONNREFUSED` in the dev log | Typesense is unreachable — see the two rows above. |
| Chat returns `matchLevel: adjacent`, 0 results, but Postgres has products | Typesense index is empty/dropped. Re-sync with the `top-sellers` ingest job. |
| Ingest curl returns nothing / times out | Expected on long jobs (vouchers ~4min). The request is still running server-side — check the dev-server log for the `POST … 200` line and count rows in Postgres. |
| Ingest fails with "No approved campaigns found" | Either the token lacks approvals, or AccessTrade changed the approval field. Verify with the raw `/v1/campaigns` curl in RUN.md. |
| `/api/chat` returns the trading-platform 404 HTML | You hit port 3000. Use 3100. |
| Chat returns results but ignores the price ceiling | No intent API key set — expected degrade path. Set `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`). |
| Empty index / zero results after real ingest | Campaign not APPROVED on AccessTrade (D2 gate) — not a code issue. |
