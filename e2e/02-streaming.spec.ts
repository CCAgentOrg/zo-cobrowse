// E2E: streaming render contract in a real Chromium — progressive text,
// live reasoning, error card + Retry. The mock Zo server streams real SSE
// over HTTP with per-event delays so mid-stream UI states are assertable.

import { test, expect } from "@playwright/test";
import { openHarness, sendQuery, recordedAsks, clearRecordedRequests, type ExtensionHarness } from "./helpers/extension";

let h: ExtensionHarness;

test.beforeAll(async () => {
  h = await openHarness({ freshProfile: true });
});

test.afterAll(async () => {
  await h?.context.close();
});

test.describe("streaming", () => {
  test("prose answer streams progressively and renders as markdown", async () => {
    // "slow" stretches the mock's inter-event delay to 900ms
    await sendQuery(h.panel, "answer slowly: what is this page?");
    // Live feed starts: the thinking indicator is replaced by streamed spans
    await expect(h.panel.locator("#messages .msg-streaming-text").first()).toBeVisible({ timeout: 15_000 });
    await expect(h.panel.locator("#messages .msg-thinking")).toHaveCount(0);
    // Final render: full text, footer with mode chip, input re-enabled
    await expect(h.panel.locator("#messages .msg-assistant .msg-body")).toContainText("mock answer about the fixture page", { timeout: 15_000 });
    await expect(h.panel.locator(".msg-footer-mode").last()).toContainText("Co-browse");
    await expect(h.panel.locator("#query-input")).toBeEnabled();
  });

  test("thinking stream renders the collapsible Thought trace", async () => {
    await sendQuery(h.panel, "think slowly about this page");
    // The mock emits a thinking part first — the panel surfaces it live
    await expect(h.panel.locator("#messages .msg-stream-reasoning").first()).toBeVisible({ timeout: 15_000 });
    await expect(h.panel.locator(".msg-stream-reasoning-summary").first()).toContainText("Thought");
    await expect(h.panel.locator("#messages .msg-assistant .msg-body").last()).toContainText("mock answer", { timeout: 20_000 });
  });

  test("Zo error card appears with Retry; Retry re-sends the query", async () => {
    await clearRecordedRequests();
    await sendQuery(h.panel, "please trigger the error response");
    await expect(h.panel.locator(".error-card-title").first()).toContainText("Response interrupted", { timeout: 15_000 });
    await expect(h.panel.locator(".error-card-detail").first()).toContainText("Mock upstream failure");
    const before = (await recordedAsks()).length;
    await h.panel.click(".error-card-retry");
    // Retry re-submits the SAME query as a fresh ASK_ZO
    await expect(async () => {
      expect((await recordedAsks()).length).toBeGreaterThan(before);
    }).toPass({ timeout: 10_000 });
    const last = (await recordedAsks()).pop();
    expect(last.body.input).toContain("please trigger the error response");
  });

  test("user bubble carries the page mention pill", async () => {
    const user = h.panel.locator("#messages .msg-user").last();
    await expect(user.locator(".msg-mention-label")).toContainText("Fixture Home");
  });
});
