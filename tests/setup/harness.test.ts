// Smoke test for the test harness itself (manager-owned).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GazetteerSchema, CONTRACT_VERSION } from "@/lib/contract";
import gazetteer from "@/data/gazetteer.json";

test("harness resolves @/ alias, extensionless TS, and JSON imports", () => {
  assert.equal(CONTRACT_VERSION, "1.1.0");
  assert.ok(GazetteerSchema.safeParse(gazetteer).success);
});
