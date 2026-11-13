import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberToken, parseClaimedValue } from "@/lib/ai/article/parseNumber";

test("thousands separators and decimals", () => {
  assert.equal(parseNumberToken("10,000")?.value, 10000);
  assert.equal(parseNumberToken("1,234,567")?.value, 1234567);
  assert.equal(parseNumberToken("24.4")?.value, 24.4);
  assert.equal(parseNumberToken("1,900")?.isMoney, false);
});

test("$X million / billion and letter suffixes", () => {
  assert.deepEqual(parseNumberToken("$190 million"), { value: 190e6, raw: "$190 million", isPercent: false, isMoney: true });
  assert.equal(parseNumberToken("$1.2 billion")?.value, 1.2e9);
  assert.equal(parseNumberToken("$190M")?.value, 190e6);
  assert.equal(parseNumberToken("$5.5B")?.value, 5.5e9);
  assert.equal(parseNumberToken("$2bn")?.value, 2e9);
  assert.equal(parseNumberToken("10k")?.value, 10000);
  assert.equal(parseNumberToken("2 million")?.value, 2e6);
  assert.equal(parseNumberToken("190 million dollars")?.isMoney, true);
  assert.equal(parseNumberToken("190 million dollars")?.value, 190e6);
});

test("percentages stay as written at token level", () => {
  assert.deepEqual(parseNumberToken("15%"), { value: 15, raw: "15%", isPercent: true, isMoney: false });
  assert.equal(parseNumberToken("15 percent")?.isPercent, true);
  assert.equal(parseNumberToken("2.5%")?.value, 2.5);
});

test("number words and malformed tokens are not guessed", () => {
  assert.equal(parseNumberToken("a dozen"), undefined);
  assert.equal(parseNumberToken("ten thousand"), undefined);
  assert.equal(parseNumberToken("half"), undefined);
  assert.equal(parseNumberToken(""), undefined);
  assert.equal(parseNumberToken("1,23"), undefined);
  assert.equal(parseNumberToken("10 minutes"), undefined);
});

test("percent becomes a fraction only for metrics that accept percents", () => {
  assert.equal(parseClaimedValue("15%", "transit_share"), 0.15);
  assert.equal(parseClaimedValue("62 percent", "support_share"), 0.62);
  assert.equal(parseClaimedValue("20%", "traffic"), 0.2);
  assert.equal(parseClaimedValue("15%", "daily_riders"), undefined);
  assert.equal(parseClaimedValue("15%", "capital_cost_usd"), undefined);
  assert.equal(parseClaimedValue("15%", undefined), undefined);
});

test("non-percent values pass through with units applied", () => {
  assert.equal(parseClaimedValue("10,000", "daily_riders"), 10000);
  assert.equal(parseClaimedValue("$190 million", "capital_cost_usd"), 190e6);
  assert.equal(parseClaimedValue("$5.58", "cost_per_rider"), 5.58);
  assert.equal(parseClaimedValue("a dozen", "daily_riders"), undefined);
});
