// E2E: the options page — Test Connection, the Prompts editor's live preview,
// and Reset-to-defaults — against the mock endpoints.
//
// NOTE (finding): options.js's Test Connection posts to a HARDCODED
// https://api.zo.computer/zo/ask, ignoring the configured zoApiUrl — the
// spec intercepts that URL with Playwright routing to keep the test hermetic.

import { test, expect } from "@playwright/test";
import { launchExtension, seedExtensionConfig } from "./helpers/extension";

test.describe("options page", () => {
  test("Test Connection succeeds against the mocked Zo API", async () => {
    const { context, extensionId, serviceWorker } = await launchExtension({ freshProfile: true });
    try {
      await seedExtensionConfig(serviceWorker);
      const page = await context.newPage();
      // The options page fetches the hardcoded prod URL — intercept it.
      await page.route("https://api.zo.computer/zo/ask", (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: "ZO_OK" }),
      );
      await page.route("https://cashlessconsumer.zo.space", (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: "" }),
      );
      await page.goto(`chrome-extension://${extensionId}/options.html`);

      // The seeded token shows as present; Test Connection goes green
      await expect(page.locator("#access-token")).toHaveValue(/.+/);
      await page.click("#test-btn");
      await expect(page.locator("#status-message")).toContainText("Connection successful", { timeout: 10_000 });
      await expect(page.locator("#status-message")).toHaveClass(/ok/);
    } finally {
      await context.close();
    }
  });

  test("Prompts editor previews the built prompt and saves overrides", async () => {
    const { context, extensionId, serviceWorker } = await launchExtension({ freshProfile: true });
    try {
      await seedExtensionConfig(serviceWorker);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);

      // The editor loads Modes via dynamic import; the preview paints
      const pre = page.locator("#prompt-preview-pre");
      await expect(pre).toContainText("You are Zo", { timeout: 10_000 });

      // Editing instructions updates the live preview
      const instr = page.locator("#prompt-instructions");
      await instr.fill("E2E INSTRUCTIONS MARKER");
      await expect(pre).toContainText("E2E INSTRUCTIONS MARKER", { timeout: 5_000 });

      // Save persists a sparse override (original built-ins untouched)
      await page.click("#prompt-save");
      await expect(page.locator("#prompt-status")).toContainText(/saved/i, { timeout: 5_000 });
      const stored = await serviceWorker.evaluate(() =>
        new Promise((r) => chrome.storage.local.get("cobrowse_mode_overrides", (v) => r(v.cobrowse_mode_overrides))),
      );
      expect(stored).toBeTruthy();

      // Reset-to-original deletes the override entry
      await page.click("#prompt-reset");
      await expect(page.locator("#prompt-status")).toContainText(/reset|original/i, { timeout: 5_000 });
      const afterReset = await serviceWorker.evaluate(() =>
        new Promise((r) => chrome.storage.local.get("cobrowse_mode_overrides", (v) => r(v.cobrowse_mode_overrides))),
      );
      expect(afterReset ?? {}).toEqual({});
    } finally {
      await context.close();
    }
  });
});
