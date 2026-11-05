// End-to-end smoke driver: drives the running app like a user + verifies the
// attribution contract in the DB. Requires the dev server up and seed-dev.ts
// having run. Exit 0 = all checks pass.
// Run from repo root:
//   npx tsx --env-file=.env .claude/skills/run-deal-finder-chat/smoke.ts
// Override target: BASE_URL=http://localhost:3100 (default)
import { prisma } from "@/lib/db";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const WEBVIEW_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // Catalog-agnostic: derive the query from a product actually in the DB, so
  // the driver works against both the dev seed and a real ingested catalog.
  const sample = await prisma.product.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!sample) {
    console.error("No products in DB — run the seed or an ingest job first.");
    process.exit(1);
  }
  const query = sample.name.split(/\s+/).slice(0, 3).join(" ");
  console.log(`(querying with: "${query}")`);

  // 1. Chat: real VN query returns ranked results, zero aff_link strings.
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: query }),
  });
  const chatBody = await chatRes.text();
  const chat = JSON.parse(chatBody) as {
    matchLevel: string;
    results: { id: string; href: string }[];
  };
  check("chat returns 200", chatRes.ok);
  check("chat has results", chat.results.length > 0, `${chat.results.length} @ ${chat.matchLevel}`);
  check("chat body has no aff_link/affLink", !/aff_?link/i.test(chatBody));
  check("results link to /go/", chat.results.every((r) => r.href.startsWith("/go/")));

  // 2. No-match cascade: a query no catalog can satisfy must still return a
  // labeled, non-empty result set (D7) rather than a dead end.
  const nm = (await (
    await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "zzqx tàu ngầm hạt nhân xyzzy dưới 1000 đồng" }),
    })
  ).json()) as { matchLevel: string; results: unknown[] };
  check("no-match returns a non-empty labeled set", nm.results.length > 0, nm.matchLevel);

  // 3. /go: 302, cookie, clickId on outbound URL; webview UA recorded.
  const goRes = await fetch(`${BASE}/go/${chat.results[0].id}?c=smoke`, {
    redirect: "manual",
    headers: { "user-agent": WEBVIEW_UA },
  });
  const location = goRes.headers.get("location") ?? "";
  const setCookie = goRes.headers.get("set-cookie") ?? "";
  const clickId = /utm_content=([0-9a-f-]{36})/.exec(location)?.[1];
  check("/go/<valid> is 302", goRes.status === 302);
  check("outbound URL carries clickId (utm_content)", !!clickId);
  check("df_click cookie set + re-armed", /df_click=/.test(setCookie) && /Max-Age=/.test(setCookie));

  // 4. /go/<garbage> → 404
  const bad = await fetch(`${BASE}/go/garbage-id`, { redirect: "manual" });
  check("/go/garbage is 404", bad.status === 404);

  // 5. Completion beacon with the cookie /go just set.
  const beacon = await fetch(`${BASE}/api/track/complete`, {
    method: "POST",
    headers: { cookie: `df_click=${clickId}` },
  });
  check("completion beacon is 204", beacon.status === 204);

  // 6. DB row: isWebview, completedAt, hashed IP only, campaign captured.
  const ev = clickId ? await prisma.clickEvent.findUnique({ where: { clickId } }) : null;
  check("ClickEvent written", !!ev);
  check("isWebview detected from UA", ev?.isWebview === true);
  check("completedAt stamped", ev?.completedAt != null);
  check("campaign captured", ev?.campaign === "smoke");
  check("no raw IP (hash only)", !ev?.ipHash || /^[0-9a-f]{64}$/.test(ev.ipHash));

  console.log(failures === 0 ? "\nsmoke: ALL PASS" : `\nsmoke: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
