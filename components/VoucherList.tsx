"use client";

// "Voucher" tab: active voucher codes from GET /api/vouchers, soonest-expiring
// first, with merchant filter pills and incremental "Xem thêm" paging. Cards
// follow the chat tab's idiom (rounded-3xl white cards, ink CTA). The CTA is a
// plain <a target="_blank" rel="nofollow sponsored noopener"> to /go/v/<id> —
// never next/link (prefetch would fire the redirect, invariant 3).

import { useEffect, useState } from "react";
import type { VoucherItem, VouchersResponse } from "@/app/api/vouchers/route";

const MERCHANT_LABELS: Record<string, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktokshop: "TikTok Shop",
  tikivn: "Tiki",
};

const MERCHANT_BADGE: Record<string, string> = {
  shopee: "bg-shopee",
  lazada: "bg-lazada",
  tiktokshop: "bg-tiktokshop",
};

function merchantLabel(slug: string): string {
  return (
    MERCHANT_LABELS[slug] ??
    slug
      .split(/[_-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function formatEnd(iso: string | null): string | null {
  if (!iso) return null;
  const end = new Date(iso);
  const today = new Date();
  const isToday =
    end.getFullYear() === today.getFullYear() &&
    end.getMonth() === today.getMonth() &&
    end.getDate() === today.getDate();
  if (isToday) return "Hết hạn hôm nay";
  return `HSD ${end.toLocaleDateString("vi-VN")}`;
}

function LoadingCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-3xl bg-neutral-200" aria-hidden />
      ))}
    </div>
  );
}

export function VoucherList({ onCtaClick }: { onCtaClick?: () => void }) {
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [total, setTotal] = useState(0);
  const [merchants, setMerchants] = useState<string[]>([]);
  const [merchant, setMerchant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load(filter: string | null, offset: number) {
    const params = new URLSearchParams();
    if (filter) params.set("merchant", filter);
    if (offset > 0) params.set("offset", String(offset));
    const res = await fetch(`/api/vouchers?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as VouchersResponse;
  }

  async function show(filter: string | null) {
    setMerchant(filter);
    setLoading(true);
    setError(false);
    try {
      const data = await load(filter, 0);
      setVouchers(data.vouchers);
      setTotal(data.total);
      setMerchants(data.merchants);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  async function showMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await load(merchant, vouchers.length);
      setVouchers((v) => [...v, ...data.vouchers]);
      setTotal(data.total);
    } catch {
      /* keep what we have — the button stays for a retry */
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void show(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  async function copy(v: VoucherItem) {
    if (!v.code) return;
    try {
      await navigator.clipboard.writeText(v.code);
      setCopiedId(v.id);
      setTimeout(() => setCopiedId((cur) => (cur === v.id ? null : cur)), 2000);
    } catch {
      /* clipboard unavailable — the code is selectable text */
    }
  }

  return (
    <div className="pt-2">
      {merchants.length > 1 && (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
          {[null, ...merchants].map((m) => (
            <button
              key={m ?? "all"}
              onClick={() => void show(m)}
              aria-pressed={merchant === m}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold focus:outline-2 focus:outline-offset-2 focus:outline-ink ${
                merchant === m
                  ? "border-ink bg-ink text-white"
                  : "border-neutral-200 bg-white text-neutral-500"
              }`}
            >
              {m ? merchantLabel(m) : "Tất cả"}
            </button>
          ))}
        </div>
      )}

      {loading && <LoadingCards />}

      {error && !loading && (
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xl text-red-600"
              aria-hidden
            >
              ⚠
            </span>
            <div>
              <p className="text-sm font-bold sm:text-base">Chưa tải được voucher</p>
              <p className="text-sm text-neutral-500 sm:text-base">
                Kết nối đang trục trặc — thử lại nhé.
              </p>
            </div>
          </div>
          <button
            onClick={() => void show(merchant)}
            className="mt-3 min-h-11 rounded-2xl bg-ink px-6 text-sm font-bold text-white sm:text-base focus:outline-2 focus:outline-offset-2 focus:outline-ink"
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && vouchers.length === 0 && (
        <div className="pt-16 text-center text-base text-neutral-500 sm:text-lg">
          Chưa có voucher nào đang chạy — quay lại sau nhé.
        </div>
      )}

      {!loading && !error && vouchers.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {vouchers.map((v) => {
              const end = formatEnd(v.endTime);
              return (
                <div key={v.id} className="flex flex-col rounded-3xl bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold text-white ${MERCHANT_BADGE[v.merchant] ?? "bg-neutral-700"}`}
                    >
                      {merchantLabel(v.merchant)}
                    </span>
                    {v.shop && (
                      <span className="truncate text-xs font-semibold text-neutral-400 sm:text-sm">
                        {v.shop}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 flex-1 text-sm font-semibold text-neutral-800 sm:text-base">
                    {v.title}
                  </p>
                  {end && (
                    <p
                      className={`mt-2 text-xs font-semibold sm:text-sm ${end === "Hết hạn hôm nay" ? "text-note" : "text-neutral-400"}`}
                    >
                      {end}
                    </p>
                  )}
                  <div className="mt-4 flex items-stretch gap-2">
                    {v.code && (
                      <button
                        onClick={() => void copy(v)}
                        title="Sao chép mã"
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-3 font-mono text-sm font-bold text-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
                      >
                        <span className="truncate">{v.code}</span>
                        <span className="shrink-0 text-xs font-sans font-bold text-neutral-500">
                          {copiedId === v.id ? "Đã chép ✓" : "Sao chép"}
                        </span>
                      </button>
                    )}
                    <a
                      href={`/go/v/${v.id}`}
                      target="_blank"
                      rel="nofollow sponsored noopener"
                      onClick={onCtaClick}
                      className={`flex min-h-11 items-center justify-center rounded-2xl bg-ink px-5 text-sm font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-ink ${v.code ? "" : "flex-1"}`}
                    >
                      Dùng ngay
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {vouchers.length < total && (
            <button
              onClick={() => void showMore()}
              disabled={loadingMore}
              className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl border border-neutral-200 bg-white text-sm font-bold text-neutral-800 sm:text-base disabled:text-neutral-400 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
            >
              {loadingMore
                ? "Đang tải…"
                : `Xem thêm (${vouchers.length}/${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
