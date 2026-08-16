// Mock Zo API + static fixture-site server for Playwright E2E.
//
// One process, two roles:
//   • http://127.0.0.1:3179/            — static e2e/fixtures/site (the "web pages")
//   • http://127.0.0.1:3179/zo/ask      — SSE streaming, scenario routed by
//     keywords in the prompt's `input` (fill/click/scroll/extract/error/…)
//   • /models/available, /personas/available, HEAD / — the endpoints the
//     extension's LIST_MODELS/LIST_PERSONAS/testConnection hit
//   • /__requests  — request recorder (GET list, DELETE clear) so specs can
//     assert on the exact prompts the extension sent
//
// No API key, no live network: the extension's zoApiUrl is seeded to this
// server via chrome.storage.local (host_permissions already include http://*/*).

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.env.E2E_PORT || 3179);
const SITE_DIR = resolve(new URL(".", import.meta.url).pathname, "../fixtures/site");
const requests = []; // {ts, method, url, body}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** SSE blocks for the real Zo protocol shape background.js parses. */
const textStart = (s) => `event: PartStartEvent\ndata: ${JSON.stringify({ index: 1, part: { part_kind: "text", content: s } })}\n\n`;
const textDelta = (s) => `event: PartDeltaEvent\ndata: ${JSON.stringify({ delta: { part_delta_kind: "text", content_delta: s } })}\n\n`;
const thinkingStart = (s) => `event: PartStartEvent\ndata: ${JSON.stringify({ index: 0, part: { part_kind: "thinking", content: s } })}\n\n`;
const completed = () => `event: completed\ndata: {}\n\n`;

/** Split prose into a few word-groups so streaming is visibly progressive.
 * Each group keeps its trailing space — concatenated deltas must reproduce
 * the original text exactly, like real token streams. */
function proseChunks(text) {
  const words = text.split(" ");
  const groups = [];
  for (let i = 0; i < words.length; i += 3) {
    const group = words.slice(i, i + 3).join(" ");
    groups.push(i + 3 < words.length ? group + " " : group);
  }
  return groups.length ? groups : [text];
}

async function streamSse(res, blocks, { delayMs = 60 } = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
    "x-conversation-id": "e2e-conv-1",
  });
  for (const block of blocks) {
    res.write(block);
    await sleep(delayMs);
  }
  res.end();
}

/** The user's actual query — the ## User Request section of the prompt (the
 * full prompt embeds page context + the action schema, whose "fill{...}"
 * text would otherwise match every action keyword). */
function userRequest(input) {
  const m = String(input || "").match(/## User Request\s*\n([^\n]*)/);
  return (m ? m[1] : String(input || "")).toLowerCase();
}

function pickScenario(input) {
  const q = userRequest(input);
  if (q.includes("fill")) return "fill";
  if (q.includes("click")) return "click";
  if (q.includes("scroll")) return "scroll";
  if (q.includes("extract")) return "extract";
  if (q.includes("error") || q.includes("fail")) return "error";
  if (q.includes("navigate")) return "navigate";
  return "prose";
}

function q_slow(input) {
  return userRequest(input).includes("slow");
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "*",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // ---- request recorder ----
  if (url.pathname === "/__requests") {
    if (req.method === "DELETE") {
      requests.length = 0;
      res.writeHead(200, { "content-type": "application/json", ...cors });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify(requests));
  }
  if (url.pathname === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  // ---- mock Zo API ----
  if (url.pathname === "/models/available" || url.pathname === "/personas/available") {
    const isModels = url.pathname.includes("models");
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(
      JSON.stringify(
        isModels
          ? { models: [{ model_name: "mock-model", label: "Mock Model", vendor: "e2e" }] }
          : { personas: [{ id: "mock-persona", name: "Mock Persona" }] },
      ),
    );
  }

  if (url.pathname === "/zo/ask" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyText = Buffer.concat(chunks).toString("utf-8");
    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {}
    requests.push({ ts: Date.now(), method: "POST", url: "/zo/ask", body });

    const scenario = pickScenario(body.input);
    if (scenario === "fill") {
      const envelope = JSON.stringify({
        reasoning: "I will fill the name, email, and plan, then submit.",
        actions: [
          { type: "fill", selector: "#name", value: "E2E Tester" },
          { type: "fill", selector: "#email", value: "e2e@example.test" },
          { type: "fill", selector: "#plan", value: "pro" },
          { type: "click", selector: "#submit-btn" },
          { type: "done", response: "Form filled and submitted." },
        ],
      });
      return streamSse(res, [textStart(envelope), completed()], { delayMs: 40 });
    }
    if (scenario === "click") {
      const envelope = JSON.stringify({
        reasoning: "Clicking the thing.",
        actions: [
          { type: "click", selector: "#action-btn" },
          { type: "done", response: "Clicked the button." },
        ],
      });
      return streamSse(res, [textStart(envelope), completed()], { delayMs: 40 });
    }
    if (scenario === "scroll") {
      const envelope = JSON.stringify({
        reasoning: "Scrolling down.",
        actions: [
          { type: "scroll", direction: "down", amount: 1200 },
          { type: "done", response: "Scrolled down." },
        ],
      });
      return streamSse(res, [textStart(envelope), completed()], { delayMs: 40 });
    }
    if (scenario === "extract") {
      const envelope = JSON.stringify({
        reasoning: "Extracting the status text.",
        actions: [
          { type: "extract", selector: "#status-card" },
          { type: "done", response: "Extracted." },
        ],
      });
      return streamSse(res, [textStart(envelope), completed()], { delayMs: 40 });
    }
    if (scenario === "navigate") {
      const envelope = JSON.stringify({
        reasoning: "Navigating to the form page.",
        actions: [
          { type: "navigate", url: `http://127.0.0.1:${PORT}/form.html` },
          { type: "done", response: "Navigated." },
        ],
      });
      return streamSse(res, [textStart(envelope), completed()], { delayMs: 40 });
    }
    if (scenario === "error") {
      res.writeHead(200, { "content-type": "text/event-stream", ...cors });
      res.write(`event: Error\ndata: ${JSON.stringify({ message: "Mock upstream failure" })}\n\n`);
      return res.end();
    }

    // default: prose with thinking + progressive text deltas ("slow" stretches
    // the delays so mid-stream UI states are assertable)
    const slow = q_slow(body.input);
    return streamSse(
      res,
      [
        thinkingStart("Let me look at the page. "),
        ...proseChunks("This is the mock answer about the fixture page.").map(textDelta),
        completed(),
      ],
      { delayMs: slow ? 900 : 60 },
    );
  }

  // ---- static fixture site ----
  let filePath = join(SITE_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(filePath)) {
    res.writeHead(404, cors);
    return res.end("not found");
  }
  const stat = statSync(filePath);
  res.writeHead(200, {
    "content-type": MIME[extname(filePath)] || "application/octet-stream",
    "content-length": stat.size,
    ...cors,
  });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] mock zo + fixture site on http://127.0.0.1:${PORT}`);
});
