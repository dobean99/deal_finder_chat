// Affiliate disclosure (PRD §6 Compliance). Rendered once per page in the
// root layout rather than under every result set — the commission
// relationship is a standing fact about the product, not a per-result note.
export function Disclosure() {
  return (
    // pb-40 clears the fixed chips+input bar that overlays the page bottom
    <footer className="px-4 pb-40 pt-2 text-center">
      <p className="text-xs text-neutral-500">
        Liên kết tiếp thị — mình có thể nhận hoa hồng, bạn không trả thêm.
      </p>
    </footer>
  );
}
