// Regression + performance guard for extractClaimsDeterministic (QA #3).
// expected-claims.json was snapshotted from the extractor BEFORE the clause-break
// precomputation landed; the output must stay byte-for-byte identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { ExtractedClaim } from "@/lib/contract";
import { extractClaimsDeterministic } from "@/lib/ai/article/extractClaims";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/articles/${name}`, import.meta.url));
}

test("output is unchanged against the pre-optimisation snapshot on every fixture", () => {
  const expected = JSON.parse(readFileSync(fixturePath("expected-claims.json"), "utf8")) as Record<string, ExtractedClaim[]>;
  const names = Object.keys(expected);
  assert.deepEqual(names.sort(), ["brt-campbellton.txt", "clifton-rail.txt", "no-claims.txt", "streetcar-east.txt"]);
  for (const name of names) {
    const actual = extractClaimsDeterministic(readFileSync(fixturePath(name), "utf8"));
    assert.deepEqual(actual, expected[name], name);
  }
});

test("20,000 chars dense with claims finishes well under the old ~600 ms", () => {
  const dense = "redlined 18% ".repeat(Math.ceil(20000 / 13)).slice(0, 20000);
  extractClaimsDeterministic(dense); // warm up regex engine / JIT
  const t0 = performance.now();
  const claims = extractClaimsDeterministic(dense);
  const ms = performance.now() - t0;
  assert.ok(claims.length > 0);
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
});
