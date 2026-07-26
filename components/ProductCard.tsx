// Product card per Prompt B, restyled to the app/public/screens mockups:
// merchant badge overlaid bottom-left on the image, "Đáng mua nhất" pill on
// the image, extrabold price, gray voucher chips, full-width dark CTA.
// Best pick gets a cream "NHIỀU ƯU ĐÃI" wrapper. CTA is a plain <a
// target="_blank" rel="nofollow sponsored noopener"> — never next/link
// (prefetch would fire the /go redirect, invariant 3). No stars, no ratings —
// "Phổ biến" is the strongest quality claim allowed (invariant 5).

import type { ResultCard } from "@/app/api/chat/route";

const MERCHANT_STYLE: Record<string, { label: string; className: string }> = {
  shopee: { label: "Shopee", className: "bg-shopee" },
  lazada: { label: "Lazada", className: "bg-lazada" },
  tiktokshop: { label: "TikTok Shop", className: "bg-tiktokshop" },
};

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + "₫";
}

export function ProductCard({
  card,
  isBestPick,
  onCtaClick,
}: {
  card: ResultCard;
  isBestPick?: boolean;
  onCtaClick?: () => void;
}) {
  const merchant = MERCHANT_STYLE[card.merchant] ?? {
    // Unknown merchants arrive as raw slugs ("cellphones_cps") — prettify.
    label: card.merchant
      .split(/[_-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    className: "bg-neutral-700",
  };

  const cardBody = (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="relative aspect-square bg-neutral-100">
        {card.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- CDN images, no optimization pipeline in v1
          <img src={card.image} alt={card.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-400">Không có ảnh</div>
        )}
        {isBestPick && (
          <span className="absolute right-2 top-2 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
            ✓ Đáng mua nhất
          </span>
        )}
        <span
          className={`absolute bottom-2 left-2 max-w-[85%] truncate rounded-lg px-2.5 py-1 text-xs font-bold text-white ${merchant.className}`}
        >
          {merchant.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-base font-bold leading-snug text-neutral-900">{card.name}</p>
        {card.popular && (
          <span className="self-start rounded-lg bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
            Phổ biến
          </span>
        )}
        <p className="text-2xl font-extrabold tracking-tight text-neutral-900">
          {formatVnd(card.price)}
          {card.originalPrice != null && card.originalPrice > card.price && (
            <span className="ml-2 text-sm font-normal text-neutral-400 line-through">
              {formatVnd(card.originalPrice)}
            </span>
          )}
        </p>
        {/* Feed prices lag the merchant's live page (R3: no unverifiable price
            claims) — frame the number as a reference, not a promise. */}
        <p className="-mt-1 text-xs text-neutral-400">Giá tham khảo — có thể thay đổi trên sàn</p>
        {card.vouchers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.vouchers.map((v, i) => (
              <span
                key={i}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-700"
              >
                {v.code ?? v.content.slice(0, 24)}
              </span>
            ))}
          </div>
        )}
        <a
          href={card.href}
          target="_blank"
          rel="nofollow sponsored noopener"
          onClick={onCtaClick}
          className="mt-auto inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-ink px-3 text-sm font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-ink"
        >
          <span className="truncate">Xem deal trên {merchant.label}</span>
          <span className="shrink-0" aria-hidden>↗</span>
        </a>
      </div>
    </div>
  );

  if (isBestPick) {
    return (
      <div className="flex w-64 shrink-0 flex-col rounded-2xl bg-cream pt-1 sm:w-auto">
        <p className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-cream-label">
          Nhiều ưu đãi
        </p>
        <div className="flex-1">{cardBody}</div>
      </div>
    );
  }
  return <div className="w-64 shrink-0 sm:w-auto">{cardBody}</div>;
}
