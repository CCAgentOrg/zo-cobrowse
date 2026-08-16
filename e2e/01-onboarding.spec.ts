// E2E: first-run onboarding tour — fresh profile, tour shows, skip works,
// chat view becomes usable. (Runs first alphabetically; later specs seed the
// onboarding flag directly, so they don't depend on this one.)

import { test, expect } from "@playwright/test";
import { launchExtension, seedExtensionConfig } from "./helpers/extension";

test.describe("onboarding (fresh profile)", () => {
  test("tour shows on first run; Skip lands in the chat view", async () => {
    const { context, extensionId, serviceWorker } = await launchExtension({ freshProfile: true });
    try {
      // Seed the mock endpoints but NOT the onboarding flag.
      await seedExtensionConfig(serviceWorker, { sync: { cobrowse_onboarding_done: false } });

      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

      await expect(panel.locator("#onboarding-view")).toBeVisible({ timeout: 15_000 });
      await expect(panel.locator("#ob-title")).toContainText("Welcome to Zo Co-browse");

      // Skip the tour → chat view + composer ready
      await panel.click("#ob-skip");
      await expect(panel.locator("#chat-view")).toBeVisible();
      await expect(panel.locator("#query-input")).toBeEnabled();
      // The flag persisted for future runs
      const flag = await serviceWorker.evaluate(() => new Promise((r) => chrome.storage.sync.get("cobrowse_onboarding_done", (v) => r(v.cobrowse_onboarding_done))));
      expect(flag).toBe(true);
    } finally {
      await context.close();
    }
  });
});
