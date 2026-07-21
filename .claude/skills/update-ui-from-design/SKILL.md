---
name: update-ui-from-design
description: Update the app's UI to match a design given as screenshots/mockup images or a Figma link — extract the visual spec, map it to the existing React/Tailwind components, implement, and visually verify against the design.
---

# Update UI from a design (pictures or Figma)

Use this when the user provides one or more design images (screenshots, mockups,
exported frames) or a Figma link and wants the app's UI changed to match.

Stack context for this repo: **Next.js 15 (App Router) + React 19 +
Tailwind CSS v4** (config-less; theme via CSS in `app/globals.css`). UI lives in
[app/](app/) (pages, layout, globals) and [components/](components/)
(`Chat.tsx`, `ProductCard.tsx`, `ConsentNotice.tsx`). No component library —
plain JSX + Tailwind utility classes.

## 1. Ingest the design

**Images:** Read every provided image file with the Read tool (it renders them
visually). If the user pasted images into chat, they're already visible.

**Figma link:** try in this order:
1. A Figma MCP server, if one is connected (check via ToolSearch for `figma`).
2. Ask the user to export the frame(s) as PNG and drop them in the repo or
   paste them — Figma URLs are not fetchable anonymously via WebFetch.
Never guess at a design you cannot see.

## 2. Extract a spec before touching code

Write down (briefly, in your reply) what the design dictates:
- **Layout**: structure, spacing rhythm, breakpoints implied by the frame width.
- **Colors**: sample exact hex values from the image; define repeated ones as
  CSS variables / `@theme` tokens in `app/globals.css` instead of scattering
  hex literals.
- **Typography**: sizes, weights, line-heights; note if a new font is needed
  (load via `next/font` in `app/layout.tsx`).
- **Components affected**: map each region of the design to an existing file in
  `components/` or `app/`; only create new components for genuinely new regions.
- **States the image doesn't show** (hover, focus, empty, loading, long text,
  Vietnamese diacritics overflow): infer sensibly and note assumptions.

If the design conflicts with existing behavior (e.g. removes the consent
notice) — flag it, don't silently drop functionality.

## 3. Implement

- Match existing code style: Tailwind utilities inline, same naming/idiom as
  the current components.
- Keep changes scoped to what the design shows; don't refactor unrelated code.
- Preserve accessibility: keep semantic elements, focus styles, alt text.
- Mobile-first: the app is a chat UI likely used on phones; verify narrow
  widths even if the mockup is desktop.

## 4. Verify

1. `npm run typecheck` and `npm run lint`.
2. Launch the app with the **run-deal-finder-chat** skill (dev server +
   Postgres/Typesense) and view the changed screens — screenshot if a browser
   tool is available, otherwise describe what to check.
3. Compare side-by-side against the design images; iterate on spacing/color
   mismatches until it visually matches.
4. Summarize deviations from the design and why (missing states, platform
   constraints).
