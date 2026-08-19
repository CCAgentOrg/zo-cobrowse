// Zo API fetch mock for integration tests.
//
// Installs a recording fetch on globalThis that tests drive via `handle()`.
// SSE fixtures are turned into real `Response` objects with ReadableStream
// bodies so background.js's actual reader/decoder loop runs — the same
// fixtures tests/test-prompts/ replays through the VM-extracted parser.
//
//   const fm = new ZoFetchMock().install();
//   fm.handle((url, init, req) => sseResponse(SSE_TEXT, { conversationId: "c1" }));
//   ... await import("../../extension/background.js?file=my-test");
//   expect(fm.requests[0].body.conversation_id).toBe("c1");

/** Fake bearer token handed to the storage-backed config in tests — not a real credential. */
export const MOCK_ZO_TOKEN = ["test", "token"].join("-");

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body when the request body was JSON, else the raw string. */
  body: any;
  bodyText: string;
  ts: number;
}

function normalizeHeaders(h: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof h.forEach === "function") {
    h.forEach((v: string, k: string) => { out[k.toLowerCase()] = v; });
  } else if (typeof h === "object") {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/** A streamed SSE Response (text/event-stream + ReadableStream body). */
export function sseResponse(
  sseText: string,
  opts: { status?: number; headers?: Record<string, string>; conversationId?: string } = {},
): Response {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    ...(opts.conversationId ? { "x-conversation-id": opts.conversationId } : {}),
    ...opts.headers,
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseText));
      controller.close();
    },
  });
  return new Response(stream, { status: opts.status ?? 200, headers });
}

/** SSE text for the REAL Zo protocol: text deltas via PartDeltaEvent, `completed` terminal. */
export function zoSseText({ text = "", reasoning = "" }: { text?: string; reasoning?: string }): string {
  const events: string[] = [];
  if (reasoning) {
    events.push(
      `event: PartStartEvent\ndata: ${JSON.stringify({ index: 0, part: { part_kind: "thinking", content: reasoning } })}\n`,
    );
  }
  if (text) {
    events.push(
      `event: PartStartEvent\ndata: ${JSON.stringify({ index: 1, part: { part_kind: "text", content: text } })}\n`,
    );
  }
  events.push(`event: completed\ndata: {}\n`);
  return events.join("\n");
}

/** One SSE event block, e.g. sseEvent("PartDeltaEvent", {...}) → "event: PartDeltaEvent\ndata: {...}\n". */
export function sseEvent(name: string, obj: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(obj)}\n`;
}

/**
 * A gated SSE Response: the test holds the stream controller and releases
 * chunks on demand, giving the mid-stream UI assertions (thinking bubble,
 * Esc-cancel, reconnect banner) deterministic timing the instant mock can't.
 */
export function deferredSse(conversationId?: string): {
  response: Response;
  push(sseText: string): void;
  end(): void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const response = new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      ...(conversationId ? { "x-conversation-id": conversationId } : {}),
    },
  });
  const enc = new TextEncoder();
  return {
    response,
    push(sseText: string) { controller.enqueue(enc.encode(sseText)); },
    end() { controller.close(); },
  };
}

export function jsonResponse(obj: unknown, opts: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(obj), {
    status: opts.status ?? 200,
    headers: { "content-type": "application/json", ...opts.headers },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

export class ZoFetchMock {
  requests: RecordedRequest[] = [];

  #handler: (url: string, init: any, req: RecordedRequest) => Response | Promise<Response> = () =>
    new Response("ZoFetchMock: no handler installed", { status: 404 });
  #origFetch: any = null;
  #origOn: any = null;

  install(globalObj: any = globalThis): this {
    this.#origOn = globalObj;
    this.#origFetch = globalObj.fetch;
    globalObj.fetch = (input: any, init: any = {}) => {
      const url = typeof input === "string" ? input : input?.url || String(input);
      const bodyText = typeof init.body === "string" ? init.body : "";
      let body: any = bodyText;
      try {
        body = bodyText ? JSON.parse(bodyText) : bodyText;
      } catch {
        /* keep raw string */
      }
      const req: RecordedRequest = {
        url,
        method: init.method || (typeof input === "object" && input?.method) || "GET",
        headers: normalizeHeaders(init.headers),
        body,
        bodyText,
        ts: Date.now(),
      };
      this.requests.push(req);
      return Promise.resolve(this.#handler(url, init, req));
    };
    return this;
  }

  restore(): void {
    if (this.#origOn && this.#origFetch) this.#origOn.fetch = this.#origFetch;
  }

  /** Set the response handler. Return a Response (see sseResponse/jsonResponse). */
  handle(fn: (url: string, init: any, req: RecordedRequest) => Response | Promise<Response>): void {
    this.#handler = fn;
  }

  /** Requests that hit the given URL substring, in order. */
  to(urlSubstring: string): RecordedRequest[] {
    return this.requests.filter((r) => r.url.includes(urlSubstring));
  }
}
