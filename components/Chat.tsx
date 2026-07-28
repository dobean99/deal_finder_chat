"use client";

// Chat UI per Prompt B, restyled to the app/public/screens mockups: "Tìm deal"
// header with logo mark, "Trò chuyện"/"Tạo link" tab pills under the promo
// banner (link tab renders LinkBuilder and hides the composer), hero empty
// state, dark pill user bubbles, shimmer bar while loading, error card with
// retry, always-visible suggestion chips, pill input with circular ↑ send
// button.
// Completion beacon: after a CTA click we wait ~1.5s (so /go has responded and
// set the df_click cookie) then POST /api/track/complete — stamping
// completedAt on the ClickEvent (F10 redirect-completion signal).

import { useEffect, useRef, useState } from "react";
import type { ChatResponse } from "@/app/api/chat/route";
import type { SuggestionsResponse } from "@/app/api/suggestions/route";
import { LinkBuilder } from "@/components/LinkBuilder";
import { ProductCard } from "@/components/ProductCard";
import { ServiceCard } from "@/components/ServiceCard";
import { PromoBanner, type BannerItem } from "@/components/PromoBanner";

interface Turn {
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
}

// Static fallback — replaced by /api/suggestions ("hot" = our own 30-day
// click data + best-sellers) once it responds.
const EXAMPLES = [
  "Tai nghe chống ồn dưới 1 triệu",
  "Máy xay sinh tố cầm tay",
  "Giày chạy bộ nam khoảng 800k",
  "Nồi chiên không dầu có voucher",
].map((text) => ({ text, hot: false }));

function fireCompletionBeacon() {
  setTimeout(() => {
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/track/complete");
      else void fetch("/api/track/complete", { method: "POST", keepalive: true });
    } catch {
      /* best-effort */
    }
  }, 1500);
}

function LoadingBar() {
  return <div className="h-6 w-56 animate-pulse rounded-full bg-neutral-200" aria-label="Đang tìm deal" />;
}

export function Chat({
  banners = [],
  initialTab = "chat",
}: {
  banners?: BannerItem[];
  /** "link" when rendered from /sharelink — the tab's shareable URL. */
  initialTab?: "chat" | "link";
}) {
  const [tab, setTab] = useState<"chat" | "link">(initialTab);

  function switchTab(key: "chat" | "link") {
    setTab(key);
    // Keep the URL shareable per tab (/ ↔ /sharelink) without a server
    // round-trip; Next syncs usePathname with native replaceState.
    window.history.replaceState(null, "", key === "link" ? "/sharelink" : "/");
  }
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chips, setChips] = useState(EXAMPLES);
  const lastPromptRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/suggestions")
      .then((r) => (r.ok ? (r.json() as Promise<SuggestionsResponse>) : null))
      .then((data) => {
        if (data && data.chips.length > 0) setChips(data.chips);
      })
      .catch(() => {
        /* keep static examples */
      });
  }, []);

  async function send(prompt: string, isRetry = false) {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setError(null);
    setInput("");
    lastPromptRef.current = trimmed;
    if (!isRetry) setTurns((t) => [...t, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ChatResponse;
      setTurns((t) => [...t, { role: "assistant", text: data.reply, response: data }]);
    } catch {
      setError("Kết nối đang trục trặc. Nhu cầu của bạn vẫn còn — thử lại nhé.");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 lg:max-w-5xl">
      <PromoBanner items={banners} onCtaClick={fireCompletionBeacon} />

      {/* top-10 = announcement bar height; the header pins right under it */}
      <header className="sticky top-10 z-10 -mx-4 flex items-center gap-3 border-b border-neutral-200 bg-neutral-50/95 px-4 py-3 backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logos/logo-mark.png" alt="Tìm deal" className="h-10 w-10 rounded-xl" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Tìm deal</h1>
          <p className="text-sm text-neutral-500">Tìm sản phẩm, nhận deal tốt</p>
        </div>
      </header>

      <div role="tablist" aria-label="Chế độ" className="flex gap-3 py-3">
        {(
          [
            ["chat", "Trò chuyện"],
            ["link", "Tạo link"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
            className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-lg font-bold focus:outline-2 focus:outline-offset-2 focus:outline-ink ${tab === key
                ? "bg-ink text-white"
                : "border border-neutral-200 bg-white text-neutral-500"
              }`}
          >
            {tab === key && (
              <span className="text-[10px] text-shopee" aria-hidden>
                ●
              </span>
            )}
            {label}
          </button>
        ))}
      </div>

      {tab === "link" && (
        <main className="flex-1 py-4 pb-40">
          <LinkBuilder />
        </main>
      )}

      {tab === "chat" && (
        <>
          {/* pb-40 keeps the last row clear of the fixed composer bar */}
          <main className="flex-1 space-y-4 py-4 pb-40">
            {turns.length === 0 && !loading && (
              <div className="pt-16 sm:mx-auto sm:max-w-lg sm:pt-24 sm:text-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
                <img src="/logos/logo-mark.png" alt="" className="h-20 w-20 rounded-3xl sm:mx-auto" />
                <h2 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">Bạn cần mua gì?</h2>
                <p className="mt-4 max-w-md text-lg text-neutral-500 sm:mx-auto">
                  Nhắn nhu cầu của bạn — mình tìm và xếp hạng vài lựa chọn tốt nhất
                  kèm mã giảm, so giá qua Shopee, TikTok Shop và Lazada.
                </p>
                <p className="mt-6 text-base font-semibold text-neutral-400">
                  Thử một gợi ý bên dưới ↓
                </p>
              </div>
            )}

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-3xl bg-ink px-5 py-3 text-base font-semibold text-white sm:max-w-[60%]">
                    {turn.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="space-y-3">
                  <div className="max-w-[85%] rounded-3xl bg-white px-5 py-3 text-base text-neutral-800 shadow-sm sm:max-w-[70%]">
                    {turn.text}
                    {turn.response && turn.response.results.length === 0 && !turn.response.services?.length && (
                      <p className="mt-1 font-bold text-note">
                        {turn.response.adjacentCategories?.length
                          ? `Kho hàng chưa có sản phẩm khớp — bạn thử tìm trong: ${turn.response.adjacentCategories.join(", ")}.`
                          : "Kho hàng chưa có sản phẩm khớp — thử mô tả cách khác xem sao."}
                      </p>
                    )}
                  </div>
                  {turn.response && (turn.response.searchLinks?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.response.searchLinks!.map((link) => (
                        <a
                          key={link.merchant}
                          href={link.href}
                          target="_blank"
                          rel="nofollow sponsored noopener"
                          onClick={fireCompletionBeacon}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
                        >
                          <span aria-hidden>🔍</span>
                          <span className="max-w-56 truncate">
                            Tìm &ldquo;{link.query}&rdquo; trên {link.label}
                          </span>
                          <span className="shrink-0" aria-hidden>↗</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {turn.response && (turn.response.services?.length ?? 0) > 0 && (
                    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3">
                      {turn.response.services!.map((card) => (
                        <ServiceCard key={card.slug} card={card} onCtaClick={fireCompletionBeacon} />
                      ))}
                    </div>
                  )}
                  {turn.response && turn.response.results.length > 0 && (
                    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 lg:grid-cols-4">
                      {turn.response.results.map((card, idx) => (
                        <ProductCard
                          key={card.id}
                          card={card}
                          isBestPick={idx === 0 && turn.response?.matchLevel === "exact"}
                          onCtaClick={fireCompletionBeacon}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}

            {loading && <LoadingBar />}

            {error && (
              <div className="max-w-[85%] space-y-3 rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xl text-red-600" aria-hidden>
                    ⚠
                  </span>
                  <div>
                    <p className="text-base font-bold">Chưa tải được kết quả</p>
                    <p className="text-base text-neutral-500">{error}</p>
                  </div>
                </div>
                <button
                  onClick={() => void send(lastPromptRef.current, true)}
                  className="min-h-11 rounded-2xl bg-ink px-6 text-base font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-ink"
                >
                  Thử lại
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </main>

          <div className="fixed inset-x-0 bottom-0 bg-neutral-50/95 backdrop-blur">
            <div className="mx-auto max-w-3xl space-y-3 px-4 py-3 lg:max-w-5xl">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
                {chips.map((ex) => (
                  <button
                    key={ex.text}
                    onClick={() => void send(ex.text)}
                    className="min-h-11 shrink-0 rounded-full border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
                  >
                    {ex.hot ? "🔥 " : ""}
                    {ex.text}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Bạn cần mua gì?"
                  aria-label="Nhập nhu cầu mua sắm"
                  className="min-h-12 flex-1 rounded-full border border-neutral-200 bg-white px-5 text-base focus:outline-2 focus:outline-offset-1 focus:outline-ink"
                />
                <button
                  type="submit"
                  disabled={loading || input.trim() === ""}
                  aria-label="Gửi"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-xl text-white disabled:opacity-40 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
                >
                  ↑
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
