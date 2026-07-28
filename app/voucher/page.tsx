// /voucher — shareable URL for the "Voucher" tab. Renders the same Chat shell
// as / with the voucher tab pre-selected; switching tabs client-side rewrites
// the URL back and forth (see Chat.switchTab).

import type { Metadata } from "next";
import { Chat } from "@/components/Chat";
import { BANNER_CAMPAIGNS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Voucher — Tìm deal",
  description:
    "Mã giảm giá đang chạy trên Shopee, Tiki và các sàn khác — sao chép mã và dùng ngay.",
};

export default function VoucherPage() {
  // Server-side: only expose slug+name to the client; tiles whose affiliate
  // URL env var is unset are dropped (their /go/b route 404s anyway).
  const banners = BANNER_CAMPAIGNS.filter((b) => process.env[b.envVar]).map(
    ({ slug, name }) => ({ slug, name }),
  );
  return <Chat banners={banners} initialTab="voucher" />;
}
