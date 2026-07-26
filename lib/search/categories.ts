// Vietnamese intent categories ↔ AccessTrade feed slugs (the Typesense
// `category` facet). The intent parser emits free-form VN ("điện thoại");
// the index holds feed slugs ("phone_tablets"). Matching is diacritic- and
// case-insensitive substring, so "Đồ gia dụng" hits "gia dung". A value that
// is already a feed slug passes through unchanged (cascade step 4 passes raw
// slugs from listCategories()).

const SLUGS: Record<string, { label: string; keywords: string[] }> = {
  phone_tablets: {
    label: "Điện thoại & máy tính bảng",
    keywords: ["dien thoai", "smartphone", "may tinh bang", "tablet", "ipad", "iphone"],
  },
  electronic_accessories: {
    label: "Phụ kiện điện tử",
    keywords: [
      "phu kien",
      "tai nghe",
      "sac",
      "op lung",
      "loa",
      "chuot",
      "ban phim",
      "pin du phong",
      "cuong luc",
      "cap",
    ],
  },
  tv: { label: "Tivi", keywords: ["tivi", "tv"] },
  camera: { label: "Máy ảnh & camera", keywords: ["may anh", "camera"] },
  domestic_application: {
    label: "Đồ gia dụng",
    keywords: [
      "gia dung",
      "noi chien",
      "may xay",
      "quat",
      "tu lanh",
      "may giat",
      "dieu hoa",
      "may loc",
      "bep",
      "noi com",
    ],
  },
  health_and_beauty: {
    label: "Sức khỏe & làm đẹp",
    keywords: ["my pham", "lam dep", "suc khoe", "duong da", "trang diem"],
  },
  lifestyle: {
    label: "Đời sống & thời trang",
    keywords: ["thoi trang", "giay", "dep", "tui xach", "quan ao", "doi song"],
  },
  others: { label: "Khác", keywords: [] },
};

/** The full taxonomy (slug + VN label) — the categorizer's closed answer set. */
export const CATEGORY_TAXONOMY: readonly { slug: string; label: string }[] = Object.entries(
  SLUGS,
).map(([slug, def]) => ({ slug, label: def.label }));

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

/** Map a parser category (or a raw feed slug) to a feed slug; undefined if unmappable. */
export function categorySlug(category: string | undefined): string | undefined {
  if (!category) return undefined;
  if (category in SLUGS) return category;
  const norm = normalize(category);
  if (norm.length < 2) return undefined;
  for (const [slug, def] of Object.entries(SLUGS)) {
    if (def.keywords.some((k) => norm.includes(k))) return slug;
  }
  return undefined;
}

/** VN display label for a feed slug (falls back to the slug itself). */
export function categoryLabel(slug: string): string {
  return SLUGS[slug]?.label ?? slug;
}
