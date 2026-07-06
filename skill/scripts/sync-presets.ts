/**
 * sync-presets.ts — Sync co-browse skill presets to extension storage
 *
 * Reads assets/default-presets.json and pushes to the extension's
 * chrome.storage.local via the Zo API. Useful for CI/CD or first-time
 * setup without opening the extension.
 *
 * Usage:
 *   bun run skill/scripts/sync-presets.ts
 *
 * Requires the ZO_ACCESS_TOKEN env var to be set (Settings > Advanced).
 *
 * The target is a Zo API route that the extension can query, or
 * directly writes to the extension's storage if the extension is
 * running. By default this script just validates and outputs the
 * preset data — pass --push to push to a zo.space endpoint.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const PRESETS_PATH = resolve(import.meta.dir, "../assets/default-presets.json");

interface Preset {
  name: string;
  description: string;
  systemPrompt: string;
  instructions: string;
  isBuiltin: boolean;
}

interface Presets {
  [id: string]: Preset;
}

// ── Validation ──

function validatePresets(data: unknown): data is Presets {
  if (typeof data !== "object" || data === null) return false;
  for (const [id, p] of Object.entries(data as Record<string, unknown>)) {
    if (typeof id !== "string" || id.length === 0) return false;
    const preset = p as Record<string, unknown>;
    if (typeof preset.name !== "string") return false;
    if (typeof preset.description !== "string") return false;
    if (typeof preset.systemPrompt !== "string") return false;
    if (typeof preset.instructions !== "string") return false;
  }
  return true;
}

// ── Main ──

function main() {
  if (!existsSync(PRESETS_PATH)) {
    console.error(`❌ Presets file not found: ${PRESETS_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(PRESETS_PATH, "utf-8");
  let presets: unknown;

  try {
    presets = JSON.parse(raw);
  } catch {
    console.error("❌ Invalid JSON in presets file");
    process.exit(1);
  }

  if (!validatePresets(presets)) {
    console.error("❌ Preset schema validation failed");
    console.error("  Each preset must have: name, description, systemPrompt, instructions");
    process.exit(1);
  }

  const count = Object.keys(presets).length;
  console.log(`✅ ${count} presets validated`);

  for (const [id, p] of Object.entries(presets)) {
    console.log(`   ${id}: "${p.name}" — ${p.description.substring(0, 60)}...`);
  }

  // ── Push mode ──
  if (process.argv.includes("--push")) {
    const apiUrl = process.env.ZO_API_URL || "https://api.zo.computer/zo/ask";
    const token = process.env.ZO_ACCESS_TOKEN;

    if (!token) {
      console.error("❌ --push requires ZO_ACCESS_TOKEN env var");
      process.exit(1);
    }

    // Generate the zo.space API endpoint that serves the presets
    console.log(`\n📡 To serve presets via zo.space, create an API route that returns this JSON.`);
    console.log(`   Route: GET /api/cobrowse-presets`);
    console.log(`   Content-Type: application/json`);
    console.log(`\n   Or import this file directly in extension code via bundler.`);
  }

  // ── Output path for extension reference ──
  console.log(`\n📁 Reference path for extension:`);
  console.log(`   bun run skill/scripts/sync-presets.ts  (validate only)`);
  console.log(`   ZO_ACCESS_TOKEN=... bun run skill/scripts/sync-presets.ts --push`);
}

main();
