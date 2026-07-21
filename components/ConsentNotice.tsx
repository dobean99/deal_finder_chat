"use client";

// Lightweight, dismissable cookie/consent notice (D5 — Vietnam PDPL, Law
// 91/2025 + Decree 356). Consent choice is stored with a timestamp so it is
// verifiable. We name the attribution/analytics cookie explicitly; no raw PII
// is collected client-side.

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
      className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-xl rounded-3xl bg-ink p-5 text-white shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-lg" aria-hidden>
          🍪
        </span>
        <p className="text-base">
          Mình dùng cookie để đo lượt bấm (cookie <code>df_click</code>) và giữ
          liên kết tiếp thị hoạt động, theo PDPL. Địa chỉ IP được băm — không
          lưu thông tin nhận dạng của bạn.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => record("accepted")}
          className="min-h-12 rounded-2xl bg-white px-4 text-base font-bold text-ink focus:outline-2 focus:outline-offset-2 focus:outline-white"
        >
          Đồng ý
        </button>
        <button
          onClick={() => record("dismissed")}
          className="min-h-12 rounded-2xl border border-neutral-600 px-4 text-base font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-white"
        >
          Chỉ cookie cần thiết
        </button>
      </div>
    </div>
  );
}
