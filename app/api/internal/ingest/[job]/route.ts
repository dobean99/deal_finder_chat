// Secret-guarded ingestion entrypoints. n8n calls these on a schedule and
// does nothing else (invariant 6). Jobs are idempotent — safe to re-run.
//   POST /api/internal/ingest/products-nightly  { domain?, cat? }
//   POST /api/internal/ingest/vouchers-6h       { merchant? }
//   POST /api/internal/ingest/top-sellers       {}
// Auth: x-ingest-secret header must equal INGEST_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  ingestProducts,
  ingestVouchers,
  ingestTopSellers,
  type IngestResult,
} from "@/lib/ingest/accesstrade-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.INGEST_SECRET;
  const provided = req.headers.get("x-ingest-secret");
  if (!secret || !provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface IngestBody {
  domain?: string;
  cat?: string;
  merchant?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  const body: IngestBody = await req.json().catch(() => ({}));

  try {
    let result: IngestResult;
    switch (job) {
      case "products-nightly":
        // Shopee first per D2.
        result = await ingestProducts(body.domain ?? "shopee.vn", body.cat);
        break;
      case "vouchers-6h":
        result = await ingestVouchers(body.merchant);
        break;
      case "top-sellers":
        result = await ingestTopSellers();
        break;
      default:
        return NextResponse.json({ error: `unknown job: ${job}` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Fail loud (R13) — n8n surfaces non-2xx as workflow failures.
    console.error(`[ingest:${job}] failed`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
