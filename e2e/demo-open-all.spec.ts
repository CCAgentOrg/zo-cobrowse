// Demo recording: the #27 link-chips card + "Open all" flow, paced for
// viewing and captured via Playwright's recordVideo (headless new-Chromium).
//
// NOT part of the normal e2e suite — run it explicitly:
//   ZO_DEMO=1 bunx playwright test -c e2e/playwright.config.ts demo-open-all
// The webm lands in e2e/demo-video/ (finalized on context.close()); convert
// with: ffmpeg -i <panel.webm> -pix_fmt yuv420p demo/open-all-demo.mp4

import { test, expect } from "@playwright/test";
import { openHarness, sendQuery, waitForTurnComplete, E2E_BASE, type ExtensionHarness } from "./helpers/extension";

const DEMO = process.env.ZO_DEMO === "1";
const VIDEO_DIR = new URL("./demo-video/", import.meta.url).pathname;
const SIZE = { width: 1280, height: 800 };

test.describe("demo: open all links (#27)", () => {
  test.skip(!DEMO, "demo recording — run with ZO_DEMO=1");
  test.setTimeout(120_000);

  test("research answer → link chips → Open all → referenced tabs", async () => {
    const h: ExtensionHarness = await openHarness({
      freshProfile: true,
      sitePath: "/form.html",
      viewport: SIZE,
      recordVideo: { dir: VIDEO_DIR, size: SIZE },
    });
    const pause = (ms: number) => h.panel.waitForTimeout(ms);
    try {
      // 1. The starting point: a page open, the sidepanel ready
      await pause(1500);

      // 2. Ask a research question ("slow" → visibly progressive streaming)
      await sendQuery(h.panel, "slowly give me links to the fixture pages");
      await expect(h.panel.locator("#messages .msg-streaming-text").first()).toBeVisible({ timeout: 15_000 });
      await waitForTurnComplete(h.panel);

      // 3. The answer settles; the link-chips card appears under it
      const card = h.panel.locator("#messages .msg-assistant .msg-links").last();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await pause(1200);
      await card.hover();
      await pause(1200);

      // 4. Open all — three tabs open, all auto-referenced in the strip
      await h.panel.locator(".msg-links-open-all").last().click();
      await expect(h.panel.locator("#tab-strip .tab-chip-on")).toHaveCount(3, { timeout: 10_000 });
      await pause(2000);

      // 5. Hold on the referenced tab strip (the read_tab synergy)
      await h.panel.locator("#tab-contexts").hover();
      await pause(2500);
    } finally {
      // Video finalizes on close — resolve the path before closing.
      const video = h.panel.video();
      await h.context.close();
      if (video) {
        const path = await video.path().catch(() => null);
        if (path) console.log(`[demo] video: ${path}`);
      }
    }
  });
});
