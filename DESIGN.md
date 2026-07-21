# Deal Finder Chat — Design System

Mobile-first chat for a Vietnamese affiliate deal-finder. One job: type a product need, get a ranked shortlist of buyable cards. Calm, neutral shell; **color carries meaning** (marketplace identity), never decoration.

---

## 1. Brand

**Logo** — ink squircle (13px-radius corners on a 44px grid) holding a custom **"đ"** glyph (đồng, Vietnamese currency), with an orange **deal-locator spark** (Shopee-orange dot ringed in ink) at top-right. The spark nods to deals + search without committing to any one marketplace.

- Mark only: `exports/logos/logo-mark.png` (transparent)
- Lockup (mark + wordmark): `exports/logos/logo-lockup.png`
- Wordmark: **Tìm deal**
- Tagline: **Nhắn nhu cầu, nhận deal tốt.**

Minimum mark size 24px. Keep the ink squircle background — never place the white glyph on a light surface.

---

## 2. Color

Neutral, near-monochrome shell so marketplace color reads instantly.

| Token | Hex | Use |
|---|---|---|
| Ink | `#17191E` | Logo, user bubbles, primary buttons, headings |
| Ink-hover | `#2A2D34` | Button/CTA hover |
| Text primary | `#20242B` | Card names, body |
| Text secondary | `#5B616B` | Supporting copy |
| Text muted | `#8A9098` / `#9298A0` | Meta, disclosure, placeholders |
| Surface (app) | `#F4F5F7` | Conversation background |
| Surface (card) | `#FFFFFF` | Cards, assistant bubbles |
| Page (behind device) | `#EBEDF0` | Canvas |
| Hairline | `#E9EAEE` / `#EAEBEE` / `#E0E2E6` | Borders, dividers |
| Focus ring | `#2F6BFF` | Keyboard focus (3px, 2px offset) |

**Marketplace colors — the one place color is allowed to speak.** Used only on the platform badge (and card accents):

| Marketplace | Hex |
|---|---|
| Shopee | `#EE4D2D` |
| TikTok Shop | `#111114` |
| Lazada | `#0F146D` |

**Accents (earned, not decorative):**
- Prominent-card ribbon "Nhiều ưu đãi": text `#7A6A3F` on `#ECEAE4`, warm border `#E2DED3`.
- "Phổ biến" chip: `#6B7079` on `#F1F2F4`. This is the strongest quality claim allowed — **no star ratings**.
- Error accent: `#C8462B` on `#FBEDEA`.

No gradients as decoration (only a faint white sheen on the logo and placeholder image tiles). No cream-and-terracotta. No fake-urgency red.

---

## 3. Type

**Be Vietnam Pro** (Google Fonts) — chosen for clean diacritic rendering. Weights 400/500/600/700/800.

| Role | Size / weight |
|---|---|
| Empty-state H1 | 26px / 800, `-.02em` |
| Section / wordmark | 15px / 700 |
| Body, bubbles | 14.5px / 500, line-height 1.45 |
| Card name | 13.5px / 600, 2-line clamp (min-height 37px) |
| Price | 18px / 800 |
| Original (strikethrough) | 13px / 500, `#A0A6AD` |
| Chips, meta | 11–12.5px / 600 |
| Disclosure | 11.5px / 400, `#9298A0` |

Sentence case everywhere. Vietnamese, conversational, plain verbs, no filler. Buttons say exactly what happens ("Xem deal trên Shopee", "Thử lại", "Đồng ý").

---

## 4. Shape & spacing

- Device frame: 400×842, radius 42px.
- Cards: radius 16px, 1px hairline border, width ~204px in the scroll row.
- Bubbles: 18px radius with a 5px "tail" corner (user bottom-right, assistant top-left).
- Buttons/CTA: radius 12px; pills (examples, best-pick, chips) radius 999px.
- Card image: `aspect-ratio 1/1`, calm tonal placeholder gradient (rotate through 5 tones).
- Gaps via flex/grid `gap` (12–16px), never margin hacks.

---

## 5. Components

- **User bubble** — ink, white text, right-aligned, max 82%.
- **Assistant bubble** — white, hairline border, left-aligned; short VN intro line, then the card row.
- **Product card** — square image · marketplace badge (bottom-left of image) · optional best-pick tag (top-right) · 2-line name · optional "Phổ biến" chip · bold price + optional strikethrough · voucher chips · full-width CTA "Xem deal trên {platform}" (opens new tab).
- **Best pick** — "Đáng mua nhất" ink pill on the top-ranked card only. Earned by score.
- **Prominent card** — cards with ≥2 vouchers get the "Nhiều ưu đãi" ribbon + slightly stronger shadow. A ribbon, not a redesign.
- **Card row** — horizontal scroll-snap on mobile; responsive grid on desktop.
- **Composer** — pinned bottom; 48px pill input + 48px round send; 3–4 tappable example prompts above for cold-start.
- **Consent notice** — dismissable ink card (VN PDPL), two actions.
- **Affiliate disclosure** — muted line beneath every result set. Always present.

---

## 6. States

- **Empty** — logo + welcome line + example prompts. No dead air.
- **Loading** — skeleton cards (shimmer), never a spinner.
- **Result** — intro line + ranked cards + disclosure.
- **No exact match** — broadened results with an honest amber label ("Không có… — đây là gần nhất"). Never a dead-end, never an apology.
- **Error** — plain, actionable, with "Thử lại". Keeps the user's need.

---

## 7. Accessibility

- Touch targets ≥ 44px (inputs 48px).
- Visible focus: 3px `#2F6BFF` ring, 2px offset, on every interactive element.
- Conversation is an `aria-live="polite"` log.
- `prefers-reduced-motion`: animations/transitions reduced to ~0.
- Semantic labels on icon-only controls (send, CTA target/new-tab).

---

## 8. Voice

Vietnamese, conversational, plain verbs, sentence case, no filler. State what a button does. Strongest quality claim is "phổ biến" — no ratings, no urgency, no hype.
