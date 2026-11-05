// Commission report from the Conversion table (synced by the `conversions`
// ingest job). Joins each conversion back to the click that caused it via
// utm_content (lib/tracking/outbound.ts).
//
//   npm run report:conversions              # last 30 days
//   npm run report:conversions -- --days 90
//   npm run report:conversions -- --sync    # pull from AccessTrade first

import { prisma } from "@/lib/db";
import { ingestConversions } from "@/lib/ingest/conversions";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}₫`;

interface Row {
  key: string;
  label: string | null;
  orders: number;
  pending: number;
  approved: number;
  rejected: number;
}

function printTable(title: string, rows: Row[]) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  console.table(
    rows.map((r) => ({
      source: r.label ? `${r.key} — ${r.label.slice(0, 50)}` : r.key,
      lines: r.orders,
      pending: vnd(r.pending),
      approved: vnd(r.approved),
      rejected: vnd(r.rejected),
    })),
  );
}

// Commission split by status; shared by both queries below.
const SUMS = `
  count(*)::int AS orders,
  coalesce(sum(c."commissionVnd") FILTER (WHERE c.status = 0), 0)::int AS pending,
  coalesce(sum(c."commissionVnd") FILTER (WHERE c.status = 1), 0)::int AS approved,
  coalesce(sum(c."commissionVnd") FILTER (WHERE c.status = 2), 0)::int AS rejected`;

async function main() {
  const i = process.argv.indexOf("--days");
  const days = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 30) : 30;

  if (process.argv.includes("--sync")) {
    const r = await ingestConversions(Math.max(days, 90));
    console.log(`synced ${r.processed} conversions from AccessTrade`);
  }

  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  console.log(`Conversions since ${since.toISOString().slice(0, 10)} (${days} days)`);

  const bySurface = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT coalesce(c."utmCampaign", '(untagged)') AS key, NULL AS label, ${SUMS}
     FROM "Conversion" c
     WHERE c."transactionTime" >= $1
     GROUP BY 1 ORDER BY sum(c."commissionVnd") FILTER (WHERE c.status IN (0, 1)) DESC NULLS LAST`,
    since,
  );
  printTable("By surface (utm_campaign; '(untagged)' = click predates tagging or came from elsewhere)", bySurface);

  const byItem = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT coalesce(ce."productId", 'link:' || s.id, '(untagged)') AS key,
            max(coalesce(p.name, s."targetUrl")) AS label, ${SUMS}
     FROM "Conversion" c
     LEFT JOIN "ClickEvent" ce ON ce."clickId" = c."utmContent"
     LEFT JOIN "SharedLink" s ON s.id = c."utmContent"
     LEFT JOIN "Product" p ON p.id = ce."productId"
     WHERE c."transactionTime" >= $1
     GROUP BY 1 ORDER BY sum(c."commissionVnd") FILTER (WHERE c.status IN (0, 1)) DESC NULLS LAST LIMIT 20`,
    since,
  );
  printTable("Top sources (product id, voucher:, banner:, link:<slug>, …)", byItem);
}

main()
  .catch((err) => {
    console.error("conversions-report failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
