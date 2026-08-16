// E2E: conversation persistence — a completed turn survives a sidepanel
// reload, and the history view lists + searches conversations.

import { test, expect } from "@playwright/test";
import { openHarness, sendQuery, waitForTurnComplete } from "./helpers/extension";

test.describe("persistence", () => {
  test("a turn survives panel reload; history lists and searches it", async () => {
    const h = await openHarness({ freshProfile: true });
    try {
      await sendQuery(h.panel, "remember this exchange");
      await expect(h.panel.locator("#messages .msg-assistant .msg-body").last()).toContainText("mock answer", { timeout: 20_000 });
      // Wait for the FULL turn to complete before reloading — the streaming
      // span can show the answer before STREAM_DONE persists it, and a reload
      // in that window would drop the assistant message.
      await waitForTurnComplete(h.panel);

      // Reload the panel — conversation + messages restore from storage
      await h.panel.reload();
      await expect(h.panel.locator("#messages .msg-user").first()).toContainText("remember this exchange", { timeout: 15_000 });
      await expect(h.panel.locator("#messages .msg-assistant .msg-body").first()).toContainText("mock answer");
      // Page context re-captured after reload
      await expect(h.panel.locator("#page-url")).toContainText("Fixture Home");

      // History view: the conversation is listed (auto-titled from the query)
      await h.panel.click("#history-btn");
      await expect(h.panel.locator("#history-view")).toBeVisible();
      await expect(h.panel.locator("#history-list")).toContainText("remember this exchange", { timeout: 5_000 });

      // Live search filters the list
      await h.panel.fill("#history-search", "no-such-conversation-xyz");
      await expect(h.panel.locator("#history-list")).not.toContainText("remember this exchange", { timeout: 5_000 });
      await h.panel.fill("#history-search", "remember");
      await expect(h.panel.locator("#history-list")).toContainText("remember this exchange", { timeout: 5_000 });
    } finally {
      await h.context.close();
    }
  });
});
