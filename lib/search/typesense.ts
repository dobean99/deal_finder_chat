// Typesense layer: `products` collection, diacritic + typo tolerant search on
// `name`. The chat path searches ONLY this index — never AccessTrade (inv. 1).
// `product` field = internal Product.id (ref back to Postgres for voucher join
// and for /go resolution). affLink is deliberately NOT indexed.

import Typesense, { Client } from "typesense";
import type { SearchIntent, Candidate } from "@/lib/affiliate/ranking";
import { MAX_RESULTS, MIN_RESULTS } from "@/lib/config";
import { categorySlug } from "@/lib/search/categories";

const COLLECTION = "products";

export interface ProductDoc {
  id: string; // == Product.id
  product: string; // internal Product.id ref (kept explicit per spec)
  name: string;
  merchant: string;
  category: string;
  price: number;
  hasVoucher: boolean;
  salesRank: number; // 0 = unknown
  image: string;
  // `embedding` (float[]) also exists on hybrid-enabled collections — auto-
  // computed by Typesense from `name`; never set or read by application code.
}

/**
 * Auto-embedding field for hybrid (keyword + semantic) search. Typesense
 * computes it server-side from `name` on import and embeds the query at
 * search time. Model choice is empirical: multilingual-e5-small ordered
 * Vietnamese probes wrongly (near-identical distances); mpnet separates them
 * cleanly (see scripts/enable-hybrid-search.ts history, 2026-07-26).
 * Existing installs are upgraded by scripts/enable-hybrid-search.ts; search()
 * detects the field at runtime, so code and index can deploy independently.
 */
export const EMBEDDING_FIELD = {
  name: "embedding",
  type: "float[]" as const,
  embed: {
    from: ["name"],
    model_config: { model_name: "ts/paraphrase-multilingual-mpnet-base-v2" },
  },
};

let client: Client | null = null;

export function getTypesense(): Client {
  if (!client) {
    client = new Typesense.Client({
      nodes: [
        {
          host: process.env.TYPESENSE_HOST ?? "localhost",
          port: Number(process.env.TYPESENSE_PORT ?? 8108),
          protocol: process.env.TYPESENSE_PROTOCOL ?? "http",
        },
      ],
      apiKey: process.env.TYPESENSE_API_KEY ?? "",
      connectionTimeoutSeconds: 5,
    });
  }
  return client;
}

/**
 * Idempotently create the products collection. Tries hybrid (with the
 * embedding field) first; if the Typesense node can't load the model —
 * "memory required ... exceeds free memory", seen on small cloud clusters —
 * falls back to keyword-only so ingestion never bricks on cluster sizing.
 * search() detects the field at runtime either way.
 */
export async function ensureCollection(): Promise<void> {
  const ts = getTypesense();
  const exists = await ts
    .collections(COLLECTION)
    .exists()
    .catch(() => false);
  if (exists) return;
  try {
    await createCollection(true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/memory/i.test(msg)) throw e;
    console.warn(`[typesense] embedding model doesn't fit this node (${msg}) — creating keyword-only collection`);
    await createCollection(false);
  }
}

async function createCollection(withEmbedding: boolean): Promise<void> {
  const ts = getTypesense();
  await ts.collections().create({
    name: COLLECTION,
    fields: [
      { name: "product", type: "string", index: false, optional: true },
      // locale "vi" gives diacritic-insensitive matching; typo tolerance is
      // Typesense's default (num_typos=2) at query time.
      { name: "name", type: "string", locale: "vi" },
      { name: "merchant", type: "string", facet: true },
      { name: "category", type: "string", facet: true, optional: true },
      { name: "price", type: "int64", facet: true },
      { name: "hasVoucher", type: "bool", facet: true },
      { name: "salesRank", type: "int32", optional: true },
      { name: "image", type: "string", index: false, optional: true },
      ...(withEmbedding ? [EMBEDDING_FIELD] : []),
    ],
    default_sorting_field: "price",
  });
}

// Whether the live collection carries the embedding field (pre-migration
// installs don't). Cached after first probe; reset is a process restart.
let hybridProbe: Promise<boolean> | null = null;
function hybridEnabled(): Promise<boolean> {
  hybridProbe ??= getTypesense()
    .collections(COLLECTION)
    .retrieve()
    .then((schema) => schema.fields?.some((f) => f.name === EMBEDDING_FIELD.name) ?? false)
    .catch(() => {
      hybridProbe = null; // transient failure — probe again next search
      return false;
    });
  return hybridProbe;
}

export async function upsertProducts(docs: ProductDoc[]): Promise<void> {
  if (docs.length === 0) return;
  await ensureCollection();
  const ts = getTypesense();
  const results = await ts
    .collections<ProductDoc>(COLLECTION)
    .documents()
    .import(docs, { action: "upsert" });
  const failed = results.filter((r: { success: boolean }) => !r.success);
  if (failed.length > 0) {
    throw new Error(`Typesense upsert: ${failed.length}/${docs.length} docs failed`);
  }
}

/** Diacritic-insensitive normalization, mirroring the index's locale-"vi"
 * matching ("Ốp lưng" → "op lung"). */
function normalizeVi(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // strip combining marks (the class is the literal U+0300–U+036F range)
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

/**
 * Token index where the query first matches in the name, or MAX_SAFE_INTEGER.
 * Real products lead with the query term ("iPhone 15 Pro Max" → 0); listings
 * that merely mention it bury it ("Ốp lưng dành cho iPhone" → 3).
 */
export function queryPosition(name: string, terms: string[]): number {
  const words = terms.flatMap((t) => normalizeVi(t).split(/\s+/)).filter(Boolean);
  if (words.length === 0) return Number.MAX_SAFE_INTEGER;
  const tokens = normalizeVi(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (words.some((w) => tokens[i].startsWith(w))) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

export interface SearchOptions {
  /** Drop the price ceiling (no-match cascade step 2). */
  ignorePriceMax?: boolean;
  /** Search by category only, ignoring keywords (cascade step 3). */
  categoryOnly?: boolean;
  /** Override category (cascade step 4 — adjacent categories). */
  categoryOverride?: string;
  limit?: number;
}

/**
 * Search the index with a parsed intent. Returns bare Candidates (vouchers are
 * joined later from Postgres by the chat route).
 */
export async function search(intent: SearchIntent, opts: SearchOptions = {}): Promise<Candidate[]> {
  const ts = getTypesense();

  const filters: string[] = [];
  // Parser categories are free-form VN ("điện thoại"); the index holds feed
  // slugs ("phone_tablets") — always go through the mapping.
  const slug = categorySlug(opts.categoryOverride ?? intent.category);
  if (opts.categoryOnly) {
    if (!slug) return []; // unmappable category — let the cascade move on
    filters.push(`category:=${slug}`);
  }
  if (intent.priceMin != null) filters.push(`price:>=${intent.priceMin}`);
  if (intent.priceMax != null && !opts.ignorePriceMax) filters.push(`price:<=${intent.priceMax}`);
  if (intent.mustHaveVoucher) filters.push("hasVoucher:=true");

  const queryTerms = opts.categoryOnly
    ? "*"
    : [intent.brand, ...intent.keywords].filter(Boolean).join(" ") || "*";

  // Hybrid (keyword + semantic) when the index has embeddings and there are
  // actual query terms; wildcard/category browses stay keyword-only.
  const hybrid = queryTerms !== "*" && (await hybridEnabled());

  // Category boost (not filter): thousands of accessories carry a model name
  // ("Ốp lưng iPhone …") and tie on text match, so without this the cheapest
  // accessories fill the candidate pool before any actual phone/TV/etc. Docs
  // in the intent's category sort first; half-empty category data can then
  // only demote, never exclude.
  // In hybrid mode we omit sort_by entirely: Typesense orders by rank fusion
  // (0.7 keyword / 0.3 semantic), and a custom sort would zero out the
  // semantic side (paraphrase matches have no _text_match). Category
  // preference + exactness are enforced by the post-filters below either way.
  const sortBy = hybrid
    ? undefined
    : queryTerms === "*"
      ? "price:asc"
      : slug
        ? `_eval(category:=${slug}):desc,_text_match:desc,price:asc`
        : "_text_match:desc,price:asc";

  const res = await ts.collections<ProductDoc>(COLLECTION).documents().search({
    q: queryTerms,
    query_by: hybrid ? "name,embedding" : "name",
    num_typos: 2,
    // Weight matches near the start of the name so the over-fetched pool holds
    // actual products, not just the cheapest accessories mentioning the term.
    prioritize_token_position: true,
    filter_by: filters.join(" && ") || undefined,
    per_page: opts.limit ?? MAX_RESULTS * 3, // over-fetch; rank() trims later
    sort_by: sortBy,
    exclude_fields: hybrid ? "embedding" : undefined,
  });

  let hits = res.hits ?? [];
  // The boost orders in-category docs first, but rank() re-sorts by the
  // composite score where cheapest-in-set wins — a 150k₫ case would still bury
  // a 30M₫ phone. When the pool holds a full result set of in-category docs,
  // drop the rest so priceScore compares like with like. Below MIN_RESULTS we
  // keep everything: category data is sparse (most docs carry no category) and
  // a thin filter would empty legitimate result sets.
  if (slug && !opts.categoryOnly) {
    const inCategory = hits.filter((h) => h.document.category === slug);
    if (inCategory.length >= MIN_RESULTS) hits = inCategory;
  }

  // Exact-product gate: "iphone" must return iPhones, not the accessories that
  // also mention it. Both match the text; the difference is where the term
  // sits — real products lead with it, accessories bury it ("Ốp lưng dành cho
  // iPhone"). Group hits by the query's token position in the name and keep
  // the earliest groups that still fill a result set; rank() then compares
  // price/voucher among like products only. All-tied groups (e.g. every name
  // prefixed "Điện thoại …") drop nothing, and a typo'd query that never
  // string-matches lands everything in one group — both degrade safely.
  if (!opts.categoryOnly && queryTerms !== "*") {
    const terms = [intent.brand, ...intent.keywords].filter((t): t is string => !!t);
    const byPos = new Map<number, typeof hits>();
    for (const h of hits) {
      const pos = queryPosition(h.document.name, terms);
      byPos.set(pos, [...(byPos.get(pos) ?? []), h]);
    }
    const kept: typeof hits = [];
    for (const pos of [...byPos.keys()].sort((a, b) => a - b)) {
      if (kept.length >= MIN_RESULTS) break;
      kept.push(...(byPos.get(pos) ?? []));
    }
    hits = kept;
  }

  return hits.map((h: { document: ProductDoc }) => {
    const d = h.document;
    return {
      id: d.id,
      name: d.name,
      merchant: d.merchant,
      domain: "",
      price: d.price,
      image: d.image || undefined,
      category: d.category || undefined,
      salesRank: d.salesRank > 0 ? d.salesRank : undefined,
      vouchers: [],
    } satisfies Candidate;
  });
}

/** Distinct categories in the index (used for adjacent-category suggestions). */
export async function listCategories(): Promise<string[]> {
  const ts = getTypesense();
  const res = await ts.collections<ProductDoc>(COLLECTION).documents().search({
    q: "*",
    query_by: "name",
    facet_by: "category",
    per_page: 0,
    max_facet_values: 50,
  });
  const counts = res.facet_counts?.find(
    (f: { field_name: string }) => f.field_name === "category",
  );
  return (counts?.counts ?? []).map((c: { value: string }) => c.value).filter(Boolean);
}
