---
name: test-playwright
description: Write and run Playwright end-to-end tests for the Deal Finder chat UI on this Windows machine — scaffold Playwright on first use, drive the real app (chat flow, product cards, /go redirect, consent notice) in a headless browser, and capture screenshots for visual checks.
---

# E2E test with Playwright

Use this to verify UI changes in a real browser: the chat flow (prompt →
skeleton → cards), CTA `/go` redirects, the consent notice, and visual
regressions via screenshots.

## Prerequisites

The full stack must be running first — Postgres, Typesense (Docker in WSL,
keepalive!), seeded data, and the Next.js dev server. Use the
**run-deal-finder-chat** skill for all of that; don't duplicate it here.

**Ports on this machine:** the app runs on **3100** (3000 is taken by the
WSL trading-dashboard stack). A dev server on 3100 often already runs from a
previous session and hot-reloads new code — check
`curl http://localhost:3100` before starting your own. If you must start a
second instance while another holds `.next`:

```powershell
$env:NEXT_DIST_DIR='.next-alt'; npx next dev -p 3101
```

(`next.config.ts` reads `NEXT_DIST_DIR`.) Set `BASE_URL` to whichever port
answers; the config defaults to 3100.

**Empty results ≠ broken UI:** if chat returns `matchLevel: adjacent` with 0
results while Postgres has products, the Typesense index is empty — re-run
the run skill's `seed-dev.ts` (it re-indexes; the `top-sellers` job only
helps with a live AccessTrade token).

## First-time setup (skip if `playwright.config.ts` exists)

```powershell
npm i -D @playwright/test
npx playwright install chromium
```

Create `playwright.config.ts` at the repo root:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    ...devices["Pixel 7"], // NOT an iPhone profile — those need webkit; only chromium is installed
  },
  reporter: [["list"]],
});
```

Put tests in `e2e/*.spec.ts`. Add script `"test:e2e": "playwright test"` to
`package.json`. Chromium only — webkit/firefox downloads are slow on this
machine and not needed for v1.

## Writing tests for this app — invariants to respect

- CTA links are plain `<a target="_blank" rel="nofollow sponsored noopener">`
  to `/go/[id]`. To assert the redirect **without** consuming a real click
  event in a new tab, request `/go/[id]` via `page.request.get(href,
  { maxRedirects: 0 })` and assert a 3xx + `Location` header — or use
  `context.waitForEvent("page")` if you do want the full click path.
- The consent notice (dark bottom sheet) shows only when
  `localStorage.df_consent_v1` is unset — clear storage in `beforeEach` to
  test it; set it to skip it (it can cover the input bar on mobile viewports).
- Chat is async: after sending a prompt, wait for the loading bar to detach or
  a card / reply bubble to appear (`getByRole("link", { name: /Xem deal/ })`),
  not a fixed timeout.
- Seeded data comes from the run skill's `seed-dev.ts` — prompts like
  "Tai nghe chống ồn dưới 1 triệu" (a suggestion chip) return results.
  Vietnamese text in selectors is fine; prefer `getByRole`/`getByPlaceholder`
  ("Bạn cần mua gì?") over CSS classes.

Core smoke spec to keep passing (create as `e2e/chat.spec.ts` if missing):
1. Empty state renders: header "Tìm deal", hero "Bạn cần mua gì?", chips.
2. Click a suggestion chip → user bubble appears → product cards render with
   a CTA link.
3. Best pick (first exact-match card) shows "Đáng mua nhất" and the
   "NHIỀU ƯU ĐÃI" wrapper.
4. CTA href `/go/...` responds with a redirect to the merchant URL.
5. Consent notice: both buttons dismiss it and persist across reload.

## Running

```powershell
npx playwright test                                                 # all
npx playwright test e2e/chat.spec.ts --headed                       # debug
npx playwright test --grep consent                                  # subset
$env:E2E_FOLLOW_REDIRECTS='1'; npx playwright test --grep "go redirect"  # strict
```

**Real-link validation:** by default the redirect test only asserts `/go`
302s to an absolute URL — it does NOT follow the affiliate link, so seeded
demo products (`/deep_link/demo`, dead placeholder URLs that 404 for a real
user) still pass, with a warning annotation naming the link. Set
`E2E_FOLLOW_REDIRECTS=1` to fail on demo links and require the affiliate
destination to resolve (<400). Only meaningful with real AccessTrade ingest
data; demo seeds will (correctly) fail it.

For visual checks after UI work, capture screenshots and Read them:

```powershell
npx playwright screenshot --viewport-size=390,844 http://localhost:3001 shot.png
```

(Save into the session scratchpad dir, then compare against the design
mockups in `app/public/screens/` with the Read tool.)

## After the run

- Report pass/fail with actual output; on failure, attach the trace hint:
  `npx playwright test --trace on` then `npx playwright show-trace`.
- Stop any dev server you started; leave the WSL one alone.
- Test artifacts (`test-results/`, `playwright-report/`, `.next-alt/`) must be
  gitignored — check `.gitignore` when scaffolding.
