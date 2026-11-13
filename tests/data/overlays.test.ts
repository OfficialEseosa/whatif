// Validation tests for src/data/overlays/** (owned by history-researcher).
// The directory does not exist yet (phase 0); the test passes vacuously until overlay
// files are delivered, then validates every *.json file as OverlayFeature[].
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OverlayFeatureSchema } from "@/lib/contract";

const OVERLAYS_DIR = path.resolve(process.cwd(), "src", "data", "overlays");

function overlayFiles(): string[] {
  if (!existsSync(OVERLAYS_DIR)) return [];
  return readdirSync(OVERLAYS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(OVERLAYS_DIR, f));
}

test("every overlay file validates as OverlayFeature[] with unique ids", () => {
  const schema = z.array(OverlayFeatureSchema);
  for (const file of overlayFiles()) {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    const result = schema.safeParse(data);
    assert.ok(result.success, `${file}: ${result.success ? "" : JSON.stringify(result.error.issues, null, 2)}`);
    const ids = result.data.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `${file}: duplicate feature ids`);
  }
});
