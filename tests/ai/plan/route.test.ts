import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "@/app/api/plan/route";
import { PlanResponseSchema, type PlanRequest } from "@/lib/contract";

async function postPlan(body: PlanRequest) {
  const response = await POST(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 200);
  return PlanResponseSchema.parse(await response.json());
}

test("POST /api/plan produces distinct edits for grounded extensions and service changes", async () => {
  const extension = await postPlan({
    mode: "prompt",
    text: "Extend the streetcar to Ponce City Market",
  });
  assert.equal(extension.isMock, true);
  assert.equal(extension.edit.type, "extend_line");
  assert.deepEqual(extension.edit.stops.map((stop) => stop.gazetteerId), ["ponce_city_market"]);

  const frequency = await postPlan({
    mode: "fix",
    text: "Run the Atlanta Streetcar every 5 minutes",
  });
  assert.equal(frequency.isMock, true);
  assert.equal(frequency.edit.type, "change_frequency");
  assert.equal(frequency.edit.baseLineId, "atlanta_streetcar");
  assert.equal(frequency.edit.headwayMin, 5);
});

test("POST /api/plan extracts claims from the submitted article", async () => {
  const text = "The city will extend the streetcar to Ponce City Market, carrying 12,345 riders a day.";
  const response = await postPlan({ mode: "article", text });

  assert.ok(response.claims?.some((claim) =>
    claim.metric === "daily_riders" && claim.claimedValue === 12345 && text.includes(claim.quote),
  ));
});
