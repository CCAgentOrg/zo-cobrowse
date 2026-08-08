import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "acorn";

/**
 * Regression guard for the class of bug that broke the side panel:
 * sidepanel.js is loaded as type="module" (strict mode). A top-level
 * assignment to a never-declared identifier — e.g. `sendQuery = ...` with no
 * matching `function sendQuery()` / `let sendQuery` — throws ReferenceError at
 * module evaluation time and kills the entire panel. String-matching tests
 * (toContain) cannot catch this; parsing the module's top-level scope can.
 *
 * These tests parse each extension entry point as an ES module and assert that
 * every top-level `X = ...` assignment resolves to a declared binding.
 */

function collectDeclaredNames(body: any[], set: Set<string>) {
  for (const node of body) {
    switch (node.type) {
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (node.id) set.add(node.id.name);
        break;
      case "VariableDeclaration":
        for (const d of node.declarations) collectPattern(d.id, set);
        break;
      case "ImportDeclaration":
        for (const s of node.specifiers) set.add(s.local.name);
        break;
      case "ExportDefaultDeclaration":
        // export default <expr> — anonymous, no binding to record
        break;
      case "ExportNamedDeclaration":
        if (node.declaration) collectDeclaredNames([node.declaration], set);
        break;
    }
  }
}

function collectPattern(pat: any, set: Set<string>) {
  if (!pat) return;
  switch (pat.type) {
    case "Identifier":
      set.add(pat.name);
      break;
    case "ObjectPattern":
      for (const p of pat.properties) collectPattern(p.value, set);
      break;
    case "ArrayPattern":
      for (const p of pat.elements) if (p) collectPattern(p, set);
      break;
    case "RestElement":
      collectPattern(pat.argument, set);
      break;
    case "AssignmentPattern":
      collectPattern(pat.left, set);
      break;
  }
}

/** Top-level `Identifier = …` assignments whose name is never declared. */
function implicitGlobalAssignments(code: string): string[] {
  const ast: any = parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowReturnOutsideFunction: true,
  });
  const declared = new Set<string>();
  collectDeclaredNames(ast.body, declared);

  const implicit: string[] = [];
  for (const node of ast.body) {
    if (
      node.type === "ExpressionStatement" &&
      node.expression.type === "AssignmentExpression" &&
      node.expression.operator === "=" &&
      node.expression.left.type === "Identifier"
    ) {
      const name = node.expression.left.name;
      if (!declared.has(name)) implicit.push(name);
    }
  }
  return implicit;
}

const EXTENSION_FILES = [
  "sidepanel.js",
  "background.js",
  "content.js",
  "options.js",
  "lib/bang-commands.js",
  "lib/config.js",
].map((f) => resolve(import.meta.dir, "../extension", f));

describe("extension entry points parse as strict ES modules", () => {
  for (const file of EXTENSION_FILES) {
    const name = file.split("/extension/")[1];
    const code = readFileSync(file, "utf-8");

    it(`${name} has no top-level implicit-global assignments`, () => {
      // Sanity: must parse as an ES module at all.
      expect(() =>
        parse(code, {
          ecmaVersion: "latest",
          sourceType: "module",
          allowReturnOutsideFunction: true,
        }),
      ).not.toThrow();

      const implicit = implicitGlobalAssignments(code);
      expect(implicit).toEqual([]);
    });
  }

  it("sendQuery is declared before its streaming override reassigns it", () => {
    // The streaming path reassigns `sendQuery`. In a module (strict mode) that
    // requires a prior declaration (function/let/const/var). Catches the
    // regression where the declaration was deleted but the override remained.
    const code = readFileSync(
      resolve(import.meta.dir, "../extension/sidepanel.js"),
      "utf-8",
    );
    const declared = /\b(function|let|const|var)\s+sendQuery\b/.test(code);
    expect(declared).toBe(true);
  });
});
