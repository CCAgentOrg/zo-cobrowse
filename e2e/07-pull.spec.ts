// E2E: the context-on-demand pull loop (#24) in a real Chromium — Zo asks
// get_form → the background captures the COMPLETE form schema inside the
// stream → a second /zo/ask carries the `## Auto-fetched:` follow-up → Zo's
// final envelope acts on it. One user turn, two API calls, one live bubble.

import { test, expect } from "@playwright/test";
import { openHarness, sendQuery, waitForTurnComplete, recordedAsks, clearRecordedRequests } from "./helpers/extension";

test.describe("pull protocol (context-on-demand)", () => {
  test("get_form pull → in-stream schema fetch → follow-up turn → fill runs", async () => {
    const h = await openHarness({ freshProfile: true, sitePath: "/form.html" });
    try {
      await clearRecordedRequests(); // the recorder is shared across specs
      await sendQuery(h.panel, "fill the name field using the form schema");

      // Two /zo/ask calls for ONE user turn: the ask, then the auto-fetched
      // follow-up (loop runs inside the stream, before STREAM_DONE).
      await expect
        .poll(async () => (await recordedAsks()).length, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);

      const asks = await recordedAsks();
      const followUp = asks[asks.length - 1];
      expect(followUp.body.input).toContain("## Auto-fetched: form fields on");
      // The complete schema — including fields the tier-2 prompt slice already
      // carried, plus label/placeholders via the compact serializers.
      expect(followUp.body.input).toContain("[input#name type=text \"Full name\"]");
      expect(followUp.body.input).toContain("select#plan");

      // The pull rendered as a tool-trace card in the live bubble…
      await expect(h.panel.locator(".msg-stream-tool-card").filter({ hasText: "get_form" }))
        .toBeVisible({ timeout: 20_000 });

      // …and the follow-up's fill executed against the real page.
      await expect(h.site.locator("#name")).toHaveValue("Pulled E2E", { timeout: 20_000 });
      await waitForTurnComplete(h.panel);

      // get_form itself never reached the DOM executor (no card for it).
      await expect(h.panel.locator("#action-timeline .action-card")).toHaveCount(1, { timeout: 20_000 });
      await expect(h.panel.locator("#action-timeline .action-card").first()).toContainText("Fill");
    } finally {
      await h.context.close();
    }
  });
});
