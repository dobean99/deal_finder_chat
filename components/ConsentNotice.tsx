"use client";

// Lightweight, dismissable cookie/consent notice (D5 — Vietnam PDPL, Law
// 91/2025 + Decree 356). Consent choice is stored with a timestamp so it is
// verifiable. Copy follows the app/public/screens mockups; the cookie name
// (df_click) and IP hashing specifics live in the PRD/README, not on-screen.

import { useEffect, useState } from "react";

const STORAGE_KEY = "df_consent_v1";

export function ConsentNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* storage unavailable — keep the notice hidden rather than nagging */
    }
  }, []);

  const record = (choice: "accepted" | "dismissed") => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ choice, at: new Date().toISOString() }),
      );
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Thông báo cookie"
      className="fixed inset-x-3 bottom-36 z-50 mx-auto max-w-xl rounded-3xl bg-ink p-5 text-white shadow-lg"
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="mt-0.5 h-6 w-6 shrink-0 text-white/80"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none" />
        </svg>
        <p className="text-sm sm:text-base">
          Mình dùng cookie để đo lượt bấm và giữ liên kết tiếp thị hoạt động,
          theo PDPL. Không lưu thông tin nhận dạng của bạn.
        </p>
      </div>
      <div className="mt-4 flex gap-3">
        <button
          onClick={() => record("accepted")}
          className="min-h-12 flex-1 rounded-2xl bg-white px-4 text-sm font-bold text-ink sm:text-base focus:outline-2 focus:outline-offset-2 focus:outline-white"
        >
          Đồng ý
        </button>
        <button
          onClick={() => record("dismissed")}
          className="min-h-12 shrink-0 whitespace-nowrap rounded-2xl border border-neutral-600 px-4 text-sm font-bold text-white sm:text-base focus:outline-2 focus:outline-offset-2 focus:outline-white"
        >
          Chỉ cookie cần thiết
        </button>
      </div>
    </div>
  );
}
