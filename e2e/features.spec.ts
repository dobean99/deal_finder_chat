// E2E for the newer chat features: service referral cards (booking intents)
// and dynamic "hot" suggestion chips. UI rendering is tested against mocked
// API responses — the real /api/chat depends on an external LLM whose free
// quota comes and goes, and chip content shifts with live click data, so
// mocking is what makes these deterministic. The tracked redirect endpoints
// are asserted for real (they're pure server code + env).

import { test, expect } from "@playwright/test";

const CONSENT_KEY = "df_consent_v1";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    ([k]) => localStorage.setItem(k, JSON.stringify({ choice: "accepted", at: "e2e" })),
    [CONSENT_KEY],
  );
});

test.describe("hot suggestion chips", () => {
  test("render from /api/suggestions and send on click", async ({ page }) => {
    await page.route("**/api/suggestions", (route) =>
      route.fulfill({
        json: {
          chips: [
            { text: "iPhone 15 Pro Max", hot: true },
            { text: "Nồi chiên không dầu có voucher", hot: false },
          ],
        },
      }),
    );
    // Keep the chat call from reaching the real backend when the chip fires.
    await page.route("**/api/chat", (route) =>
      route.fulfill({ json: { reply: "OK", matchLevel: "exact", results: [] } }),
    );
    await page.reload();

    const hotChip = page.getByRole("button", { name: "🔥 iPhone 15 Pro Max" });
    await expect(hotChip).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Nồi chiên không dầu có voucher" }),
    ).toBeVisible();

    await hotChip.click();
    // The chip's text (without the flame) becomes the user bubble.
    await expect(page.locator("main").getByText("iPhone 15 Pro Max")).toBeVisible();
  });

  test("endpoint returns a well-formed chip list", async ({ page }) => {
    const res = await page.request.get("/api/suggestions");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { chips: { text: string; hot: boolean }[] };
    expect(body.chips.length).toBeGreaterThan(0);
    for (const chip of body.chips) {
      expect(typeof chip.text).toBe("string");
      expect(chip.text.length).toBeGreaterThan(0);
      expect(typeof chip.hot).toBe("boolean");
    }
  });
});

test.describe("service referral cards", () => {
  test("booking intent renders referral cards, not product cards", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        json: {
          reply: "Nhu cầu này là dịch vụ đặt vé — bạn đặt trực tiếp qua đối tác dưới đây nhé:",
          matchLevel: "service",
          results: [],
          services: [
            {
              slug: "vexere",
              label: "Vexere",
              tagline: "Vé xe khách & limousine khắp Việt Nam",
              merchant: "vexere",
              href: "/go/s/vexere?d=%C4%90%C3%A0%20L%E1%BA%A1t",
            },
          ],
        },
      }),
    );
    await page.reload();

    await page.getByPlaceholder("Bạn cần mua gì?").fill("vé xe đi đà lạt");
    await page.getByRole("button", { name: "Gửi" }).click();

    const cta = page.getByRole("link", { name: /Đặt trên Vexere/ });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta).toHaveAttribute("href", "/go/s/vexere?d=%C4%90%C3%A0%20L%E1%BA%A1t");
    await expect(cta).toHaveAttribute("rel", "nofollow sponsored noopener");
    // A service turn shows no product cards and no "empty catalog" note.
    await expect(page.getByRole("link", { name: /Xem deal trên/ })).toHaveCount(0);
    await expect(page.getByText(/Kho hàng chưa có sản phẩm khớp/)).toHaveCount(0);
  });

  test("/go/s/[slug] 302s to the composed deep link with tracking", async ({ page }) => {
    const res = await page.request.get("/go/s/vexere?d=%C4%90%C3%A0%20L%E1%BA%A1t", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/^https:\/\/go\.isclix\.com\/deep_link\//);
    expect(location).toMatch(/utm_content=[0-9a-f-]{36}/);
    // Attribution cookie re-armed on the hit.
    expect(res.headers()["set-cookie"] ?? "").toContain("df_click=");
  });

  test("/go/s fails closed on unknown slugs", async ({ page }) => {
    const res = await page.request.get("/go/s/unknown-merchant", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});

test.describe("marketplace search handoff", () => {
  test("/go/m/shopee 302s to deep-linked marketplace search", async ({ page }) => {
    const res = await page.request.get("/go/m/shopee?q=gi%C3%A0y%20adidas", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/^https:\/\/go\.isclix\.com\/deep_link\//);
    expect(decodeURIComponent(location)).toContain("shopee.vn/search");
    expect(location).toMatch(/utm_content=[0-9a-f-]{36}/);
  });

  test("/go/m fails closed without query or on unknown/unconfigured slugs", async ({ page }) => {
    for (const path of ["/go/m/shopee", "/go/m/amazon?q=x", "/go/m/lazada?q=x"]) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
    }
  });
});
