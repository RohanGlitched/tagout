import { test } from "node:test";
import assert from "node:assert/strict";
import { guardGreen, noModelAnswered, type ModelTrace } from "../lib/agent/verdict.ts";
import { cleanIdPath } from "../lib/clean-path.ts";
import { fatal, ModelError, retryable } from "../lib/nebius.ts";
import { leadOrder, matchItem } from "../lib/match.ts";
import type { Item, Notice, Verdict } from "../lib/types.ts";

const green: Verdict = { itemId: "i1", level: "inspected", headline: "No recall found for Lasko model CT22425.", proof: [], steps: ["Searched CPSC on 2026-10-26.", "Register it with the maker."], checkedAt: "2026-10-26", searched: ["cpsc"] };
const ok: ModelTrace = { mode: "full", useModel: true, intake: true, agent: true, reads: 1, readsFailed: 0 };

test("green stands when a model answered", () => {
  assert.equal(guardGreen(green, ok), green);
  // The lite tier: no agent by design, the list reader answered, nothing to read.
  assert.equal(guardGreen(green, { ...ok, mode: "lite", agent: false, reads: 0 }).level, "inspected");
});

test("never green when no model answered", () => {
  const cases: ModelTrace[] = [
    { ...ok, mode: "rules", useModel: false },
    { ...ok, intake: false, agent: false, reads: 0 },
    { ...ok, readsFailed: 1 },
    { ...ok, agent: false, agentFailed: true, reads: 0 },
  ];
  for (const t of cases) {
    assert.equal(noModelAnswered(t), true);
    const v = guardGreen(green, t);
    assert.equal(v.level, "warning");
    assert.equal(v.headline, "Model unavailable: not cleared.");
    assert.equal(v.degraded, "model-unavailable");
    assert.ok(v.steps.includes("Searched CPSC on 2026-10-26."));
  }
  // Red and orange tags are never touched.
  const red: Verdict = { ...green, level: "danger", headline: "Lot EJA022 is listed in this recall." };
  assert.equal(guardGreen(red, { ...ok, mode: "rules", useModel: false }), red);
});

test("trailing punctuation after a check or watch id redirects to the clean link", () => {
  assert.equal(cleanIdPath("/watch/5ehharz7sr:"), "/watch/5ehharz7sr");
  assert.equal(cleanIdPath("/check/vk9vuyk3zi%3A"), "/check/vk9vuyk3zi");
  assert.equal(cleanIdPath("/check/vk9vuyk3zi%3a"), "/check/vk9vuyk3zi");
  assert.equal(cleanIdPath("/check/vk9vuyk3zi)."), "/check/vk9vuyk3zi");
  assert.equal(cleanIdPath("/check/kj6iutme8c,"), "/check/kj6iutme8c");
  assert.equal(cleanIdPath("/watch/5ehharz7sr./feed.xml"), "/watch/5ehharz7sr/feed.xml");
  assert.equal(cleanIdPath("/api/checks/kj6iutme8c:"), "/api/checks/kj6iutme8c");
  // Clean paths, other routes and short or long ids are left alone.
  assert.equal(cleanIdPath("/watch/5ehharz7sr"), null);
  assert.equal(cleanIdPath("/watch/5ehharz7sr/feed.xml"), null);
  assert.equal(cleanIdPath("/check/short:"), null);
  assert.equal(cleanIdPath("/proof:"), null);
  assert.equal(cleanIdPath("/check/vk9vuyk3zix"), null);
});

test("model calls are retried only on rate limits, server errors and timeouts", () => {
  assert.equal(retryable(new ModelError("HTTP 429", 429)), true);
  assert.equal(retryable(new ModelError("HTTP 503", 503)), true);
  assert.equal(retryable(new ModelError("timed out")), true);
  assert.equal(retryable(new ModelError("HTTP 400", 400)), false);
  assert.equal(retryable(new ModelError("HTTP 404", 404)), false);
  assert.equal(retryable(new ModelError("deadline", undefined, undefined, true)), false);
  assert.equal(fatal(new ModelError("HTTP 402", 402)), true);
  assert.equal(fatal(new ModelError("HTTP 401", 401)), true);
  assert.equal(fatal(new ModelError("HTTP 500", 500)), false);
});

test("an orange tag's lead recall is the same whatever order the search returned them in", () => {
  const seat: Item = { id: "i4", kind: "car-seat", said: "Evenflo car seat", brand: "Evenflo", product: "car seat" };
  const mk = (id: string, date: string, models: string[] = []): Notice => ({ source: "nhtsa", id, title: `Evenflo car seats: ${id}`, date, url: `https://www.nhtsa.gov/recalls?nhtsaId=${id}`, firm: "Evenflo", models, lots: [], upcs: [] });
  const ns = [mk("25C003000", "2025-03-14"), mk("26C005000", "2026-08-06"), mk("12C003000", "2012-09-27", ["123"])];
  const rs = ns.map((notice) => ({ notice, match: matchItem(seat, notice) }));
  const a = [...rs].sort(leadOrder)[0].notice.id;
  const b = [...rs].reverse().sort(leadOrder)[0].notice.id;
  assert.equal(a, "26C005000");
  assert.equal(b, a);
});
