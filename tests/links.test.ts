import { describe, it, expect } from "bun:test";
import { extractUrls, MAX_LINK_CHIPS } from "../extension/lib/links.js";
import { ExtractedLinksSchema, ExtractedLinkSchema } from "./schemas/links.js";

function expectValid(v: unknown, what: string) {
  const p = ExtractedLinksSchema.safeParse(v);
  if (!p.success) throw new Error(`${what} failed schema:\n${JSON.stringify(v, null, 2)}\n${p.error.message}`);
  return p.data;
}

describe("extractUrls", () => {
  it("extracts markdown links and bare URLs with hosts", () => {
    const out = expectValid(extractUrls("See [the docs](https://docs.example.com/guide) or https://news.ycombinator.com for more."), "mixed");
    expect(out).toEqual([
      { url: "https://docs.example.com/guide", host: "docs.example.com" },
      { url: "https://news.ycombinator.com", host: "news.ycombinator.com" },
    ]);
  });

  it("dedupes by exact URL, first occurrence wins, order preserved", () => {
    const text = "https://a.com/x then [again](https://a.com/x) and https://b.com and https://a.com/x";
    const out = expectValid(extractUrls(text), "dedupe");
    expect(out.map((l: { url: string }) => l.url)).toEqual(["https://a.com/x", "https://b.com"]);
  });

  it("trims trailing sentence punctuation but keeps balanced path parens", () => {
    const out = extractUrls("Go to https://en.wikipedia.org/wiki/A_(band). Then https://b.com/end.");
    expect(out[0].url).toBe("https://en.wikipedia.org/wiki/A_(band)");
    expect(out[1].url).toBe("https://b.com/end");
  });

  it("drops the unbalanced closing paren of a markdown link's URL", () => {
    // The bare-URL pass sees `[t](https://x.com/p)` — the `)` is syntax, not URL.
    const out = extractUrls("[t](https://x.com/p)");
    expect(out[0].url).toBe("https://x.com/p");
  });

  it("ignores non-http schemes and text without URLs", () => {
    expect(extractUrls("mailto:a@b.com and ftp://f.com and javascript:alert(1)")).toEqual([]);
    expect(extractUrls("no urls here")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });

  it("never reads URLs inside fenced code blocks", () => {
    const text = "```\nhttps://in-code.example.com/a\nhttps://in-code.example.com/b\n```\nReal one: https://real.example.com";
    const out = expectValid(extractUrls(text), "fenced");
    expect(out).toEqual([{ url: "https://real.example.com", host: "real.example.com" }]);
  });

  it("is http-anchored (schema rejects anything else) and validates each entry", () => {
    const out = extractUrls("https://mixed.example.com/A https://b.com");
    for (const l of out) {
      const p = ExtractedLinkSchema.safeParse(l);
      expect(p.success).toBe(true);
    }
    // Parity with markdownToHtml's autolink: the scheme match is lowercase
    // http(s) only, so an uppercase-scheme "URL" neither links nor extracts.
    expect(extractUrls("HTTP://UPPER.EXAMPLE.COM/A")).toEqual([]);
  });

  it("tolerates non-string input", () => {
    expect(extractUrls(undefined)).toEqual([]);
    expect(extractUrls(null as unknown as string)).toEqual([]);
  });
});

describe("MAX_LINK_CHIPS", () => {
  it("is the documented display/open cap", () => {
    expect(MAX_LINK_CHIPS).toBe(10);
  });
});
