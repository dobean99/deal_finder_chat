// /sharelink — shareable URL for the "Tạo link" tab. Renders the same Chat
// shell as / with the link tab pre-selected; switching tabs client-side
// rewrites the URL back and forth (see Chat.switchTab).

import type { Metadata } from "next";
import { Chat } from "@/components/Chat";
import { BANNER_CAMPAIGNS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Tạo link — Tìm deal",
  description:
    "Dán link sản phẩm Shopee, Lazada, TikTok Shop để tạo link chia sẻ.",
};

export default function ShareLinkPage() {
  // Server-side: only expose slug+name to the client; tiles whose affiliate
  // URL env var is unset are dropped (their /go/b route 404s anyway).
  const banners = BANNER_CAMPAIGNS.filter((b) => process.env[b.envVar]).map(
    ({ slug, name }) => ({ slug, name }),
  );
  return <Chat banners={banners} initialTab="link" />;
}
