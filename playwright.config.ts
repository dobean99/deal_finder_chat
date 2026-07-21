import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    // Mobile-first app. Pixel 7, not iPhone: iPhone profiles need webkit and
    // only chromium is installed on this machine.
    ...devices["Pixel 7"],
  },
  reporter: [["list"]],
});
