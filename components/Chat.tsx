"use client";

// Chat UI per Prompt B, restyled to the app/public/screens mockups: "Tìm deal"
// header with logo mark, hero empty state, dark pill user bubbles, shimmer bar
// while loading, error card with retry, always-visible suggestion chips, pill
// input with circular ↑ send button.
// Completion beacon: after a CTA click we wait ~1.5s (so /go has responded and
// set the df_click cookie) then POST /api/track/complete — stamping
// completedAt on the ClickEvent (F10 redirect-completion signal).

import { useRef, useState } from "react";
import type { ChatResponse } from "@/app/api/chat/route";
import { ProductCard } from "@/components/ProductCard";

interface Turn {
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
}

const EXAMPLES = [
  "Tai nghe chống ồn dưới 1 triệu",
  "Máy xay sinh tố cầm tay",
  "Giày chạy bộ nam khoảng 800k",
  "Nồi chiên không dầu có voucher",
];

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

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPromptRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

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
      <header className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-neutral-200 bg-neutral-50/95 px-4 py-3 backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/logos/logo-mark.png" alt="Tìm deal" className="h-10 w-10 rounded-xl" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Tìm deal</h1>
          <p className="text-sm text-neutral-500">Tìm deal hời, cứ để tôi</p>
        </div>
      </header>

      {/* bottom clearance for the fixed bar comes from the global footer's pb-40 */}
      <main className="flex-1 space-y-4 py-4">
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
                {turn.response && turn.response.results.length === 0 && (
                  <p className="mt-1 font-bold text-note">
                    {turn.response.adjacentCategories?.length
                      ? `Kho hàng chưa có sản phẩm khớp — bạn thử tìm trong: ${turn.response.adjacentCategories.join(", ")}.`
                      : "Kho hàng chưa có sản phẩm khớp — thử mô tả cách khác xem sao."}
                  </p>
                )}
              </div>
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
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => void send(ex)}
                className="min-h-11 shrink-0 rounded-full border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 focus:outline-2 focus:outline-offset-2 focus:outline-ink"
              >
                {ex}
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
    </div>
  );
}
