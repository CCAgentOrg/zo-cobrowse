import { describe, it, expect } from "bun:test";
import { isSensitiveForm, redactValue, reviewRows } from "../extension/lib/formfill";
import { SensitivityVerdictSchema, ReviewRowSchema } from "./schemas/formfill";

const F = (over: Record<string, unknown> = {}) => ({ type: "text", name: "", placeholder: "", ...over });

describe("isSensitiveForm", () => {
  it("flags password fields", () => {
    const v = isSensitiveForm([F({ type: "password", name: "pw" })], "https://shop.example/cart");
    expect(SensitivityVerdictSchema.safeParse(v).success).toBe(true);
    expect(v.sensitive).toBe(true);
    expect(v.reasons[0]).toMatch(/password/i);
  });
  it("flags card/cvv/expiry by name or placeholder", () => {
    expect(isSensitiveForm([F({ name: "ccnumber" })], "").sensitive).toBe(true);
    expect(isSensitiveForm([F({ placeholder: "CVV" })], "").sensitive).toBe(true);
    expect(isSensitiveForm([F({ name: "exp-date" })], "").sensitive).toBe(true);
  });
  it("flags sensitive URLs with benign fields", () => {
    const v = isSensitiveForm([F({ name: "email" })], "https://example.com/account/login");
    expect(v.sensitive).toBe(true);
    expect(v.reasons[0]).toMatch(/URL/i);
  });
  it("passes benign forms", () => {
    const v = isSensitiveForm([F({ name: "q" }), F({ name: "email", placeholder: "Your email" })], "https://example.com/search");
    expect(v.sensitive).toBe(false);
    expect(v.reasons).toEqual([]);
  });
  it("tolerates null fields/url", () => {
    expect(isSensitiveForm(null, null).sensitive).toBe(false);
  });
});

describe("redactValue", () => {
  it("masks everything but a 2-char tail (≥4 chars)", () => {
    expect(redactValue("4242424242424242")).toBe("••••42");
  });
  it("fully masks short values and empties", () => {
    expect(redactValue("abc")).toBe("••••");
    expect(redactValue("")).toBe("");
  });
});

describe("reviewRows", () => {
  const action = { type: "fill_form" as const, values: [
    { target: "Full name", value: "Ada Lovelace" },
    { target: "Card number", value: "4242424242424242" },
    { target: "Password", value: "" },
  ]};
  const fields = [F({ name: "fullname", placeholder: "Full name" }), F({ name: "cc", placeholder: "Card number" }), F({ type: "password", name: "pw", placeholder: "Password" })];

  it("joins captured metadata, blanks secret values, redacts for display", () => {
    const rows = reviewRows(action, fields);
    for (const r of rows) expect(ReviewRowSchema.safeParse(r).success).toBe(true);
    expect(rows[0]).toMatchObject({ target: "Full name", value: "Ada Lovelace", secret: false });
    expect(rows[1].secret).toBe(true);
    expect(rows[1].value).toBe("");           // never round-trips the card number
    expect(rows[1].redacted).toBe("••••42");  // display-only
    expect(rows[2]).toMatchObject({ type: "password", secret: true, value: "" });
  });
  it("survives fields=null", () => {
    expect(reviewRows(action, null)).toHaveLength(3);
  });
});
