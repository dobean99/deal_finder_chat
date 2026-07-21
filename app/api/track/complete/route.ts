// Redirect-completion signal (F10). The chat page fires a beacon shortly after
// a CTA click; by then /go has responded and set the attribution cookie, so the
// beacon carries the clickId and we stamp completedAt on the ClickEvent.
// This is a proxy for "our redirect responded and the browser proceeded" — it
// cannot observe the merchant page itself, but it makes webview/handoff
// drop-off measurable instead of assumed (clicks with no completion ≈ the hop
// failed before our redirect finished).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ATTRIBUTION_COOKIE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const clickId = req.cookies.get(ATTRIBUTION_COOKIE)?.value;
  if (!clickId) return new NextResponse(null, { status: 204 });

  await prisma.clickEvent
    .updateMany({
      where: { clickId, completedAt: null },
      data: { completedAt: new Date() },
    })
    .catch((err) => console.error("[track] completion write failed", err));

  return new NextResponse(null, { status: 204 });
}
