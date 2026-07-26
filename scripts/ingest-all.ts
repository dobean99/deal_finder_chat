// Standalone ingest runner — same jobs as /api/internal/ingest/[job] but
// callable without a running dev server, for manual refreshes and the Windows
// scheduled tasks (see README "Scheduled ingest"). Sequential on purpose: the
// AccessTrade adapter throttles to ~28 req/min globally, so parallel domains
// would only queue behind each other anyway.
//
//   npx tsx --env-file=.env scripts/ingest-all.ts                 # full refresh
//   npx tsx --env-file=.env scripts/ingest-all.ts --vouchers-only # 6h voucher job
//
// Full refresh = products for every ingested domain + vouchers + top-sellers
// (which also re-syncs the whole Typesense index from Postgres).

import { execFileSync, spawn } from "node:child_process";
import { prisma } from "@/lib/db";
import {
  ingestProducts,
  ingestVouchers,
  ingestTopSellers,
  aggregateEngagement,
} from "@/lib/ingest/accesstrade-ingest";

/**
 * Dev-machine plumbing: Typesense lives in Docker inside WSL Ubuntu, and the
 * WSL VM idles out when nothing runs in it — a 3 AM scheduled task would find
 * the index unreachable and fail loud. Best-effort, Windows-only: boot the VM,
 * start the container, hold the VM open with a detached `sleep` for the length
 * of the job, and poll /health. On any other platform (or if Typesense is
 * already up) this is a no-op; a real deployment runs Typesense as a service.
 */
async function ensureTypesenseUp(): Promise<void> {
  const url = `${process.env.TYPESENSE_PROTOCOL ?? "http"}://${process.env.TYPESENSE_HOST ?? "localhost"}:${process.env.TYPESENSE_PORT ?? 8108}/health`;
  const healthy = async () => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
    } catch {
      return false;
    }
  };

  if (process.platform === "win32") {
    // Keepalive outlives this process via detach — 2h covers the longest run.
    spawn("wsl.exe", ["-d", "Ubuntu", "--", "sleep", "7200"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  if (await healthy()) return;
  if (process.platform !== "win32") throw new Error(`Typesense unreachable at ${url}`);

  try {
    execFileSync("wsl.exe", ["-d", "Ubuntu", "--", "docker", "start", "ts-deal"], {
      stdio: "ignore",
      timeout: 90_000,
    });
  } catch {
    /* container may already be running — the poll below decides */
  }
  for (let i = 0; i < 20; i++) {
    if (await healthy()) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Typesense still unreachable at ${url} after docker start`);
}

/** Domains already in the catalog; falls back to Shopee on an empty DB so the
 * very first run bootstraps something. */
async function ingestedDomains(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    select: { domain: true },
    distinct: ["domain"],
  });
  const domains = rows.map((r) => r.domain).filter(Boolean);
  return domains.length > 0 ? domains : ["shopee.vn"];
}

async function main() {
  const vouchersOnly = process.argv.includes("--vouchers-only");
  const started = Date.now();
  const stamp = () => `[${new Date().toISOString()}]`;

  await ensureTypesenseUp();

  if (!vouchersOnly) {
    for (const domain of await ingestedDomains()) {
      console.log(`${stamp()} products: ${domain} ...`);
      const r = await ingestProducts(domain);
      console.log(`${stamp()} products: ${domain} — ${r.processed} upserted, ${r.skippedUnapproved} unapproved skipped`);
    }
  }

  console.log(`${stamp()} vouchers ...`);
  const v = await ingestVouchers();
  console.log(`${stamp()} vouchers — ${v.processed} upserted, ${v.skippedUnapproved} unapproved skipped`);

  if (!vouchersOnly) {
    console.log(`${stamp()} top-sellers (+ full index re-sync) ...`);
    const t = await ingestTopSellers();
    console.log(`${stamp()} top-sellers — ${t.processed} products ranked`);

    console.log(`${stamp()} engagement roll-up ...`);
    const e = await aggregateEngagement();
    console.log(`${stamp()} engagement — ${e.processed} products updated`);
  }

  console.log(`${stamp()} done in ${Math.round((Date.now() - started) / 60000)} min`);
}

main()
  .catch((err) => {
    console.error("ingest-all failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
