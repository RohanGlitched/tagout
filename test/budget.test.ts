import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingNow, flushSpend, noteSpend, spendNow, SPEND, tavilyMode, tierCeiling, type Spend } from "../lib/budget.ts";

const day = (usd: number, credits = 0, keyless = 0): Spend => ({ usd, credits, keyless });
const cfg = { ...SPEND, fullUsd: 1, liteUsd: 1.5, balanceUsd: 15, reserveUsd: 6, judgingFrom: "2026-12-01", tavilyCredits: 60, tavilyKeyless: 60 };

test("dollars decide the tier: full, then lite at $1.00, then rules at $1.50", () => {
  assert.equal(tierCeiling(day(0), 0, "2026-10-26", cfg), "full");
  assert.equal(tierCeiling(day(0.99), 0.99, "2026-10-26", cfg), "full");
  assert.equal(tierCeiling(day(1.0), 1, "2026-10-26", cfg), "lite");
  assert.equal(tierCeiling(day(1.49), 1.49, "2026-10-26", cfg), "lite");
  assert.equal(tierCeiling(day(1.5), 1.5, "2026-10-26", cfg), "rules");
});

test("the judging reserve: before Dec 1 the total stops at the balance less the reserve; during judging only the balance does", () => {
  // $9 spent in all before judging: the last $6 waits for Dec 1-15.
  assert.equal(tierCeiling(day(0.1), 8.99, "2026-11-20", cfg), "full");
  assert.equal(tierCeiling(day(0.1), 9, "2026-11-20", cfg), "rules");
  assert.equal(tierCeiling(day(0.1), 9, "2026-12-03", cfg), "full");
  assert.equal(tierCeiling(day(1.2), 9, "2026-12-03", cfg), "lite");
  assert.equal(tierCeiling(day(0.1), 15, "2026-12-03", cfg), "rules");
  // SPEND_BALANCE_USD=0 turns the total off.
  assert.equal(tierCeiling(day(0.1), 100, "2026-11-20", { ...cfg, balanceUsd: 0 }), "full");
});

test("Tavily: 60 credits on the key, then 60 keyless calls, then databases only", () => {
  assert.equal(tavilyMode(day(0, 0), cfg), "keyed");
  assert.equal(tavilyMode(day(0, 59), cfg), "keyed");
  assert.equal(tavilyMode(day(0, 60), cfg), "keyless");
  assert.equal(tavilyMode(day(0, 60, 59), cfg), "keyless");
  assert.equal(tavilyMode(day(0, 60, 60), cfg), "off");
});

test("spend adds up in memory without a store, and moves the ceiling", async () => {
  assert.equal(await ceilingNow(), "full");
  noteSpend({ usd: 0.6 });
  noteSpend({ usd: 0.45, credits: 3 });
  await flushSpend();
  const s = await spendNow();
  assert.ok(Math.abs(s.day.usd - 1.05) < 1e-9);
  assert.equal(s.day.credits, 3);
  assert.equal(await ceilingNow(), "lite");
  noteSpend({ usd: 0.5 });
  assert.equal(await ceilingNow(), "rules");
});

test("TAGOUT_SPEND_GUARD=off: nothing is counted (the eval harness)", async () => {
  process.env.TAGOUT_SPEND_GUARD = "off";
  try {
    noteSpend({ usd: 100 });
    assert.equal(await ceilingNow(), "full");
    assert.equal((await spendNow()).day.usd, 0);
  } finally {
    delete process.env.TAGOUT_SPEND_GUARD;
  }
});
