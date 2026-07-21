// E2E smoke for the Tìm deal chat UI (see .claude/skills/test-playwright).
// Assumes the full stack is up (Typesense + Postgres with products) and the
// dev server answers on BASE_URL. CTA redirects are asserted via
// page.request (no navigation) so we don't consume real click events beyond
// the one ClickEvent row the /go request itself creates.

import { test, expect } from "@playwright/test";

const CONSENT_KEY = "df_consent_v1";

test.describe("empty state", () => {
  test("renders header, hero and suggestion chips", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tìm deal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bạn cần mua gì?" })).toBeVisible();
    await expect(page.getByText("Thử một gợi ý bên dưới")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tai nghe chống ồn dưới 1 triệu" }),
    ).toBeVisible();
  });
});

test.describe("chat flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Hide the consent sheet so it can't cover the input bar on mobile.
    await page.evaluate(
      ([k]) => localStorage.setItem(k, JSON.stringify({ choice: "accepted", at: "e2e" })),
      [CONSENT_KEY],
    );
    await page.reload();
  });

  test("suggestion chip returns product cards with disclosure and working /go redirect", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Tai nghe chống ồn dưới 1 triệu" }).click();

    // User bubble appears immediately.
    await expect(
      page.locator("main").getByText("Tai nghe chống ồn dưới 1 triệu"),
    ).toBeVisible();

    // Wait for the async reply: either product cards or the no-match note.
    const cta = page.getByRole("link", { name: /Xem deal trên/ }).first();
    await expect(cta).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText(/Liên kết tiếp thị/)).toBeVisible();

    // Best pick styling, when an exact match leads the row.
    const bestPick = page.getByText("Đáng mua nhất");
    if (await bestPick.isVisible()) {
      await expect(page.getByText("Nhiều ưu đãi", { exact: false })).toBeVisible();
    }

    // /go/[id] must 3xx to the merchant without us navigating the tab.
    const href = await cta.getAttribute("href");
    expect(href).toMatch(/^\/go\//);
    const res = await page.request.get(href!, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(301);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()["location"];
    expect(location).toMatch(/^https?:\/\//);

    // Seeded demo products link to /deep_link/demo — a dead placeholder that
    // 404s/500s on the merchant side. Flag it so nobody mistakes a passing
    // run for working affiliate links; with E2E_FOLLOW_REDIRECTS=1 (real
    // ingest data) we follow the link and require it to actually resolve.
    const isDemoLink = /\/deep_link\/demo\b/.test(location);
    test.info().annotations.push({
      type: isDemoLink ? "warning" : "info",
      description: isDemoLink
        ? `DEMO affiliate link (seed data) — will 404 for a real user: ${location}`
        : `affiliate link: ${location}`,
    });
    if (process.env.E2E_FOLLOW_REDIRECTS === "1") {
      expect(isDemoLink, `seed-data demo link cannot resolve: ${location}`).toBe(false);
      const dest = await page.request.get(location, { failOnStatusCode: false });
      expect(dest.status(), `affiliate destination ${location}`).toBeLessThan(400);
    }
  });

  test("typed prompt shows loading then an assistant reply", async ({ page }) => {
    await page.getByPlaceholder("Bạn cần mua gì?").fill("nồi chiên không dầu");
    await page.getByRole("button", { name: "Gửi" }).click();
    await expect(page.locator("main").getByText("nồi chiên không dầu")).toBeVisible();
    // Assistant answers with either cards or a fallback note.
    await expect(
      page
        .getByRole("link", { name: /Xem deal trên/ })
        .first()
        .or(page.getByText(/Kho hàng chưa có sản phẩm khớp/)),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("consent notice", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(([k]) => localStorage.removeItem(k), [CONSENT_KEY]);
    await page.reload();
  });

  for (const button of ["Đồng ý", "Chỉ cookie cần thiết"]) {
    test(`"${button}" dismisses the sheet and persists across reload`, async ({ page }) => {
      const sheet = page.getByRole("dialog", { name: "Thông báo cookie" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: button }).click();
      await expect(sheet).toBeHidden();
      await page.reload();
      await expect(page.getByRole("dialog", { name: "Thông báo cookie" })).toBeHidden();
    });
  }
});
