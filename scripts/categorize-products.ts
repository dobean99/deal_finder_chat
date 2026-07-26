// Offline LLM categorization: fill Product.category for rows the feed left
// blank (41k+ of ~50k — the feed's `cate` is usually empty). A stronger
// category signal makes the search-time category boost/filter and the exact-
// product gate far more precise. Search-time cost: zero — this runs offline.
//
//   npx tsx --env-file=.env scripts/categorize-products.ts [--limit N] [--batch N]
//
// - Closed taxonomy: the model picks ONLY from CATEGORY_TAXONOMY slugs (the
//   same set the intent parser maps to); anything else falls back to "others".
// - Idempotent/resumable: only rows with NULL/empty category are selected, and
//   each batch is committed (Postgres + Typesense partial update) before the
//   next — a killed run just continues where it left off.
// - Provider: Gemini when GEMINI_API_KEY is set (default model
//   gemini-2.5-flash-lite — free-tier friendly; override CATEGORIZE_MODEL),
//   else the Anthropic key via the same convention as lib/intent/parse.ts.
// - A failed/malformed batch is skipped (rows stay NULL for the next run),
//   never guessed.

import { prisma } from "@/lib/db";
import { getTypesense } from "@/lib/search/typesense";
import { CATEGORY_TAXONOMY } from "@/lib/search/categories";

const BATCH_DEFAULT = 150;
/** Gemini free tier needs heavy spacing; Anthropic tiers don't. */
const REQUEST_GAP_MS = process.env.GEMINI_API_KEY && process.env.CATEGORIZE_PROVIDER !== "anthropic" ? 4500 : 1000;

const VALID_SLUGS = new Set(CATEGORY_TAXONOMY.map((c) => c.slug));

const SYSTEM_PROMPT = `Bạn là bộ phân loại sản phẩm thương mại điện tử Việt Nam. Cho một danh sách tên sản phẩm (mỗi dòng: "<số thứ tự>. <tên>"), trả về MỘT mảng JSON các object {"i": <số thứ tự>, "c": "<mã danh mục>"} — một object cho MỖI dòng vào, giữ đúng số thứ tự của dòng. Chỉ dùng đúng các mã danh mục sau:

${CATEGORY_TAXONOMY.map((c) => `- "${c.slug}": ${c.label}`).join("\n")}

Quy tắc:
- Điện thoại/tablet NGUYÊN CHIẾC → "phone_tablets". Ốp lưng, cáp, sạc, tai nghe, loa, chuột... → "electronic_accessories".
- Laptop, PC, màn hình máy tính → "electronic_accessories" (chưa có mã riêng).
- "electronic_accessories" CHỈ dành cho phụ kiện của THIẾT BỊ ĐIỆN TỬ. Đồ ăn/thực phẩm, đồ chơi, xe đạp và phụ kiện xe/thể thao KHÔNG phải điện tử → "others" (hoặc "lifestyle" nếu là thời trang/phụ kiện cá nhân).
- Đồ dùng nhà bếp/phòng tắm/dọn dẹp không cắm điện (hộp, lọ, móc treo, kệ...) → "domestic_application".
- Không chắc chắn → "others".
- Chỉ xuất mảng JSON các object {"i", "c"}, không giải thích.`;

function apiKeyMode(): "gemini" | "anthropic" {
  const forced = process.env.CATEGORIZE_PROVIDER;
  if (forced === "gemini" || forced === "anthropic") return forced;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("Set GEMINI_API_KEY or ANTHROPIC_API_KEY");
}

async function callGemini(userText: string): Promise<string> {
  // Fall back to the intent model (known-good quota bucket on this key).
  const model =
    process.env.CATEGORIZE_MODEL ?? process.env.GEMINI_INTENT_MODEL ?? "gemini-2.5-flash-lite";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          // Thinking models silently spend the output budget on reasoning and
          // truncate the JSON array — turn it off; classification needs none.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 16384,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

async function callAnthropic(userText: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: process.env.CATEGORIZE_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

/**
 * Parse the model's [{i, c}] array into a 1-based-index → slug map. Tolerant
 * of dropped/extra rows (a miscounted batch degrades to "some rows retried
 * next run", never to misaligned categories); null only when nothing usable.
 */
function parseSlugs(text: string, expected: number): Map<number, string> | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const byIndex = new Map<number, string>();
    for (const v of arr) {
      const o = v as { i?: unknown; c?: unknown };
      const i = typeof o?.i === "number" ? o.i : NaN;
      if (Number.isInteger(i) && i >= 1 && i <= expected && typeof o?.c === "string") {
        byIndex.set(i, VALID_SLUGS.has(o.c) ? o.c : "others");
      }
    }
    return byIndex.size > 0 ? byIndex : null;
  } catch {
    return null;
  }
}

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  const batchSize = argNum("--batch", BATCH_DEFAULT);
  const limit = argNum("--limit", Number.MAX_SAFE_INTEGER);
  const mode = apiKeyMode();
  const call = mode === "gemini" ? callGemini : callAnthropic;
  const stamp = () => `[${new Date().toISOString()}]`;

  const remaining = await prisma.product.count({
    where: { OR: [{ category: null }, { category: "" }] },
  });
  console.log(`${stamp()} ${remaining} uncategorized products; provider=${mode}, batch=${batchSize}`);

  let done = 0;
  let skippedBatches = 0;
  let consecutiveFailures = 0;
  while (done < limit) {
    // A dead provider (expired key, exhausted quota) fails every batch — bail
    // instead of grinding through hundreds of doomed requests.
    if (consecutiveFailures >= 5) {
      throw new Error("5 consecutive batch failures — provider down or quota exhausted; aborting");
    }
    const rows = await prisma.product.findMany({
      where: { OR: [{ category: null }, { category: "" }] },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
      take: Math.min(batchSize, limit - done),
      // Skip batches that failed this run so we don't spin on a poison batch.
      skip: skippedBatches * batchSize,
    });
    if (rows.length === 0) break;

    const userText = rows.map((r, i) => `${i + 1}. ${r.name.slice(0, 120)}`).join("\n");
    let byIndex: Map<number, string> | null = null;
    try {
      const text = await call(userText);
      byIndex = parseSlugs(text, rows.length);
      if (!byIndex)
        console.warn(
          `${stamp()} batch unparseable (${rows.length} rows): …${text.slice(-160).replace(/\n/g, " ")}`,
        );
    } catch (e) {
      console.warn(`${stamp()} batch failed: ${e instanceof Error ? e.message : e}`);
    }
    if (!byIndex) {
      skippedBatches++;
      consecutiveFailures++;
      await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
      continue;
    }
    consecutiveFailures = 0;

    // Commit per batch: Postgres first (truth), then a partial Typesense
    // update — `emplace` upserts the field without touching the rest of the doc.
    const updates = rows.flatMap((r, i) => {
      const slug = byIndex.get(i + 1);
      return slug ? [{ id: r.id, category: slug }] : [];
    });
    for (const u of updates) {
      await prisma.product.update({ where: { id: u.id }, data: { category: u.category } });
    }
    await getTypesense().collections("products").documents().import(updates, { action: "emplace" });

    done += updates.length;
    if (updates.length < rows.length) {
      // Unanswered rows stay NULL; findMany's skip counts whole batches, so
      // count the partial batch as skipped to keep pagination moving forward.
      skippedBatches++;
    }
    console.log(`${stamp()} ${done} categorized (+${updates.length}/${rows.length} this batch)`);
    await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
  }
  console.log(`${stamp()} finished: ${done} categorized, ${skippedBatches} batches skipped`);
}

main()
  .catch((err) => {
    console.error("categorize-products failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
