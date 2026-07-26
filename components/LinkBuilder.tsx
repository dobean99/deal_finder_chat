"use client";

// "Tạo link" tab (app/public/screens mockup 2): paste a Shopee / TikTok Shop /
// Lazada product URL, get back a shareable AccessTrade deep link from
// POST /api/link. The mockup only shows the empty state (button disabled);
// success (link card + copy + open-in-new-tab) and error states follow the
// chat tab's idiom.

import { useState } from "react";
import type { LinkResponse } from "@/app/api/link/route";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: "Link chưa đúng định dạng — dán nguyên link sản phẩm nhé.",
  unsupported_merchant: "Chỉ hỗ trợ link Shopee, TikTok Shop hoặc Lazada.",
  not_configured: "Sàn này chưa được kích hoạt — thử lại sau nhé.",
};
const GENERIC_ERROR = "Kết nối đang trục trặc — thử lại nhé.";

export function LinkBuilder() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await res.json()) as LinkResponse & { error?: string };
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error ?? ""] ?? GENERIC_ERROR);
        return;
      }
      setResult(data);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  }

  const shareLink = result ? result.shortLink ?? result.affLink : null;

  async function copy() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is selectable text */
    }
  }

  return (
    <div className="pt-8 sm:mx-auto sm:max-w-lg">
      <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        Tạo link
      </h2>
      <p className="mt-3 text-lg text-neutral-500">
        Ủng hộ mình bằng cách tạo link và mua hàng bằng link bên dưới nhé!
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="mt-8"
      >
        <label htmlFor="link-input" className="block text-base font-bold text-neutral-700">
          Link sản phẩm
        </label>
        <textarea
          id="link-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          rows={3}
          placeholder="https://shopee.vn/..."
          className="mt-3 w-full resize-none rounded-3xl border border-neutral-200 bg-white p-5 font-mono text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-2 focus:outline-offset-1 focus:outline-ink"
        />
        <button
          type="submit"
          disabled={loading || url.trim() === ""}
          className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-3xl bg-ink text-lg font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {loading ? "Đang tạo link…" : "Tạo link"}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xl text-red-600"
              aria-hidden
            >
              ⚠
            </span>
            <div>
              <p className="text-base font-bold">Chưa tạo được link</p>
              <p className="text-base text-neutral-500">{error}</p>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Link affiliate · {result.label}
          </p>
          <p className="mt-2 break-all font-mono text-base font-semibold text-neutral-800">
            {shareLink}
          </p>
          {result.shortLink && (
            <p className="mt-2 break-all font-mono text-xs text-neutral-400">
              {result.affLink}
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => void copy()}
              className="min-h-11 flex-1 rounded-2xl bg-ink px-6 text-base font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-ink"
            >
              {copied ? "Đã sao chép ✓" : "Sao chép"}
            </button>
            <a
              href={shareLink ?? result.affLink}
              target="_blank"
              rel="nofollow sponsored noopener"
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-neutral-200 px-6 text-base font-bold text-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
            >
              Mở link
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M7 17 17 7" />
                <path d="M8 7h9v9" />
              </svg>
            </a>
          </div>
        </div>
      )}

      <p className="mt-8 text-base text-neutral-400">
        Link được tạo qua mạng affiliate AccessTrade. Khi có người mua qua link
        này, mình nhận hoa hồng — người mua không trả thêm chi phí.
      </p>
    </div>
  );
}
