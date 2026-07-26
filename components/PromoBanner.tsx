"use client";

// Announcement bar under the header: a slim full-bleed carousel rotating
// through approved partner campaigns (Shopee sale events, Highlands Coffee,
// The Coffee House).
// Auto-advances every ROTATE_MS; pauses on hover/focus; prev/next + dot
// controls. Hrefs are cloaked /go/b/<slug> redirects — the affiliate URL never
// reaches the client (invariant 2), and each click logs a ClickEvent + fires
// the completion beacon like a product CTA. Brand color carries merchant
// identity per DESIGN.md §2.

import { useEffect, useState } from "react";

export interface BannerItem {
  slug: string;
  name: string;
}

const ROTATE_MS = 5000;

const BRAND_BG: Record<string, string> = {
  shopee: "bg-shopee",
  lazada: "bg-lazada",
  tiktokshop: "bg-tiktokshop",
  highlands: "bg-highlands",
  thecoffeehouse: "bg-tch",
};

export function PromoBanner({
  items,
  onCtaClick,
}: {
  items: BannerItem[];
  onCtaClick?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, items.length]);

  if (items.length === 0) return null;
  const item = items[index % items.length];
  const step = (delta: number) =>
    setIndex((i) => (i + delta + items.length) % items.length);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Ưu đãi"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      // Pinned at the very top, above the sticky header (which uses top-10 to
      // sit flush under this 40px-tall bar).
      className={`sticky top-0 z-10 -mx-4 ${BRAND_BG[item.slug] ?? "bg-ink"} text-white transition-colors duration-500`}
    >
      <div className="mx-auto flex max-w-3xl items-center px-2 lg:max-w-5xl">
        {items.length > 1 && (
          <button
            aria-label="Ưu đãi trước"
            onClick={() => step(-1)}
            className="flex h-10 w-8 shrink-0 items-center justify-center text-lg text-white/75 focus:outline-2 focus:-outline-offset-2 focus:outline-white"
          >
            ‹
          </button>
        )}
        <a
          key={item.slug}
          href={`/go/b/${item.slug}`}
          target="_blank"
          rel="nofollow sponsored noopener"
          onClick={onCtaClick}
          className="animate-announce-in flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 py-2 text-sm font-semibold focus:outline-2 focus:-outline-offset-2 focus:outline-white"
        >
          <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-white/75 sm:block">
            Ưu đãi
          </span>
          <span className="truncate">{item.name}</span>
          <span aria-hidden>→</span>
        </a>
        {items.length > 1 && (
          <button
            aria-label="Ưu đãi sau"
            onClick={() => step(1)}
            className="flex h-10 w-8 shrink-0 items-center justify-center text-lg text-white/75 focus:outline-2 focus:-outline-offset-2 focus:outline-white"
          >
            ›
          </button>
        )}
        {items.length > 1 && (
          <div role="tablist" aria-label="Chọn ưu đãi" className="flex shrink-0 items-center gap-1.5 pr-2">
            {items.map((b, i) => (
              <button
                key={b.slug}
                role="tab"
                aria-selected={i === index}
                aria-label={b.name}
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/50"
                  }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
