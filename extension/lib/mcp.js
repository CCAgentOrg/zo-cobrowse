// MCP client helpers — pure logic, no chrome.*/DOM deps and no fetch (the
// transport stays in background.js, which owns every Zo API call).
//
// Shapes verified against the live server 2026-08-18 (api.zo.computer/mcp,
// server `zo-tools v1.0.0`, protocol 2024-11-05): requests are JSON-RPC 2.0
// POSTs; responses arrive either as plain application/json or as a single
// SSE `data:` frame (Content-Type text/event-stream) — both carry the same
// JSON-RPC message. tools/call results put the tool's output in
// result.content[0].text; the `bash` tool wraps stdout in a Python-style
// repr (parsed in pickers.js, not here).

let nextId = 1;

/**
 * Build a JSON-RPC 2.0 request body for the MCP endpoint.
 * Ids are monotonically increasing per worker lifetime (the protocol only
 * requires uniqueness within a session).
 *
 * @param {string} method
 * @param {object} [params]
 * @returns {{ body: string, id: number }}
 */
export function mcpRequest(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method };
  if (params !== undefined) msg.params = params;
  return { body: JSON.stringify(msg), id };
}

/**
 * Build a JSON-RPC notification (no id — no response expected).
 * @param {string} method
 * @param {object} [params]
 */
export function mcpNotification(method, params) {
  const msg = { jsonrpc: '2.0', method };
  if (params !== undefined) msg.params = params;
  return JSON.stringify(msg);
}

/** initialize params for the handshake (clientInfo identifies the extension). */
export function initializeParams() {
  return {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zo-cobrowse-extension', version: '1.0.0' },
  };
}

/** tools/call params for one tool invocation. */
export function toolCallParams(name, args) {
  return { name, arguments: args || {} };
}

/**
 * Parse a raw MCP response body (plain JSON or a single SSE `data:` frame)
 * into the JSON-RPC message. Returns null when nothing parseable is present.
 *
 * @param {string} raw
 * @returns {{ jsonrpc: string, id?: number, result?: object, error?: {code:number,message:string} } | null}
 */
export function parseMcpMessage(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let text = raw.trim();
  if (text.startsWith('event:') || text.startsWith('data:')) {
    // SSE frame: use the first data: line that holds a JSON object.
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('data:')) {
        const payload = t.slice(5).trim();
        if (payload.startsWith('{')) { text = payload; break; }
      }
    }
  }
  if (!text.startsWith('{')) return null;
  try {
    const msg = JSON.parse(text);
    if (msg && typeof msg === 'object' && msg.jsonrpc) return msg;
  } catch { /* fall through */ }
  return null;
}

/**
 * The tool's text output from a tools/call result (content[0].text), or ''
 * when the result shape doesn't carry text content.
 * @param {object} result
 * @returns {string}
 */
export function toolText(result) {
  const content = result && Array.isArray(result.content) ? result.content : [];
  const first = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
  return first ? first.text : '';
}

/** True when the server flagged the tool call as an error (isError). */
export function isToolError(result) {
  return !!(result && result.isError === true);
}
