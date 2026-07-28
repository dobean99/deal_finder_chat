// Referral card for service needs (bus/flight/activity tickets) — rendered
// when the chat detects a booking intent instead of a product one. Same CTA
// rules as ProductCard: plain <a target="_blank" rel="nofollow sponsored
// noopener"> to the tracked /go/s/{slug} redirect, never next/link (prefetch
// would fire the redirect, invariant 3). No prices or availability claims —
// we hold no inventory data for these merchants, only the referral.

import type { ServiceCard as ServiceCardData } from "@/app/api/chat/route";

export function ServiceCard({
  card,
  onCtaClick,
}: {
  card: ServiceCardData;
  onCtaClick?: () => void;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm sm:w-auto">
      <p className="text-base font-bold text-neutral-900 sm:text-lg">{card.label}</p>
      <p className="flex-1 text-sm text-neutral-500">{card.tagline}</p>
      <a
        href={card.href}
        target="_blank"
        rel="nofollow sponsored noopener"
        onClick={onCtaClick}
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-ink px-3 text-sm font-bold text-white focus:outline-2 focus:outline-offset-2 focus:outline-ink"
      >
        <span className="truncate">Đặt trên {card.label}</span>
        <span className="shrink-0" aria-hidden>↗</span>
      </a>
    </div>
  );
}
