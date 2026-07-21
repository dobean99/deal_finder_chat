// Typesense layer: `products` collection, diacritic + typo tolerant search on
// `name`. The chat path searches ONLY this index — never AccessTrade (inv. 1).
// `product` field = internal Product.id (ref back to Postgres for voucher join
// and for /go resolution). affLink is deliberately NOT indexed.

import Typesense, { Client } from "typesense";
import type { SearchIntent, Candidate } from "@/lib/affiliate/ranking";
import { MAX_RESULTS } from "@/lib/config";

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
}

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

/** Idempotently create the products collection. */
export async function ensureCollection(): Promise<void> {
  const ts = getTypesense();
  const exists = await ts
    .collections(COLLECTION)
    .exists()
    .catch(() => false);
  if (exists) return;
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
    ],
    default_sorting_field: "price",
  });
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
  const category = opts.categoryOverride ?? intent.category;
  if (opts.categoryOnly && category) filters.push(`category:=${JSON.stringify(category)}`);
  if (intent.priceMin != null) filters.push(`price:>=${intent.priceMin}`);
  if (intent.priceMax != null && !opts.ignorePriceMax) filters.push(`price:<=${intent.priceMax}`);
  if (intent.mustHaveVoucher) filters.push("hasVoucher:=true");

  const queryTerms = opts.categoryOnly
    ? "*"
    : [intent.brand, ...intent.keywords].filter(Boolean).join(" ") || "*";

  const res = await ts.collections<ProductDoc>(COLLECTION).documents().search({
    q: queryTerms,
    query_by: "name",
    num_typos: 2,
    filter_by: filters.join(" && ") || undefined,
    per_page: opts.limit ?? MAX_RESULTS * 3, // over-fetch; rank() trims later
    sort_by: queryTerms === "*" ? "price:asc" : "_text_match:desc,price:asc",
  });

  return (res.hits ?? []).map((h: { document: ProductDoc }) => {
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
