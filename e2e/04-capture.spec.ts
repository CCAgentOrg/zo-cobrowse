// E2E: context capture + the context policy, observed through the sidepanel
// prompt inspector (which computes from the SAME lib the background uses)
// and through the prompts actually recorded by the mock Zo server.

import { test, expect } from "@playwright/test";
import { openHarness, sendQuery, lastAskBody, clearRecordedRequests, type ExtensionHarness } from "./helpers/extension";

let h: ExtensionHarness;

test.beforeAll(async () => {
  h = await openHarness({ freshProfile: true });
});

test.afterAll(async () => {
  await h?.context.close();
});

test.describe("context capture + policy", () => {
  test("read queries are pointer-only (tier 0) in the inspector preview", async () => {
    await h.panel.fill("#query-input", "what is this page about");
    await h.panel.locator("#prompt-inspector").waitFor();
    // inspector re-renders debounced (150ms) on input
    await expect(h.panel.locator("#prompt-inspector-meta")).toContainText("Pointer (URL only)", { timeout: 5_000 });
    const preview = await h.panel.locator("#prompt-preview").textContent();
    expect(preview).toContain("Fixture Home"); // URL/title pointer
    expect(preview).not.toContain("## Elements");
  });

  test("an action turn's outgoing prompt carries the captured DOM (tier 2)", async () => {
    await clearRecordedRequests();
    await sendQuery(h.panel, "click the thing for me");
    await expect(h.site.locator("#status-card")).toContainText("Status: thing done", { timeout: 20_000 });
    const body = await lastAskBody();
    expect(body.input).toContain("Fixture Home"); // page title
    expect(body.input).toContain("#action-btn"); // captured selector
    expect(body.input).toContain("Status: idle"); // captured visible text
    expect(body.stream).toBe(true);
  });

  test("!context attaches the Mode's full context for ONE turn", async () => {
    // Runs AFTER the action turn above: the send-time refreshPageContext
    // captured the site at tier 2, so the inspector has real content to show.
    // (Before any send, currentContext is display-adopted only — url/title.)
    await expect(h.panel.locator("#action-run .action-run-label")).toContainText("Performed actions", { timeout: 20_000 });
    await h.panel.fill("#query-input", "!context describe everything on the page");
    // The inspector re-rendens debounced (150ms) — poll until it reflects the bang
    await expect
      .poll(async () => h.panel.locator("#prompt-preview").textContent(), { timeout: 5_000 })
      .toContain("#action-btn"); // tier-2 selectors in the preview
    await expect(h.panel.locator("#prompt-inspector-meta")).toContainText("Elements", { timeout: 5_000 });
  });

  test("tier-0 read turn sends the pointer + auto-referenced active tab, no elements", async () => {
    // Let the previous test's action run finish before switching chats
    await expect(h.panel.locator("#action-run .action-run-label")).toContainText("Performed actions", { timeout: 20_000 });
    await h.panel.click("#new-chat-btn");
    await clearRecordedRequests();
    await sendQuery(h.panel, "summarize this slowly please");
    await expect(h.panel.locator("#messages .msg-assistant .msg-body").last()).toContainText("mock answer", { timeout: 20_000 });
    const body = await lastAskBody();
    expect(body.input).toContain("Fixture Home");
    expect(body.input).toContain("## Referenced Tabs"); // auto-referenced active tab
    expect(body.input).not.toContain("## Elements");
  });
});
