import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ConsentNotice } from "@/components/ConsentNotice";


export const metadata: Metadata = {
  title: "Tìm deal",
  description:
    "Chat tìm sản phẩm giá tốt kèm voucher trên Shopee, Lazada, TikTok Shop.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">
        {children}
        <ConsentNotice />
      </body>
    </html>
  );
}
