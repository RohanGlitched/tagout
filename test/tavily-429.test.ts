// Tavily's keyless hourly cap answers 429 with a Retry-After of minutes. The app must not wait inside a check's
// deadline: the search fails at once and the check goes on with the agency databases (held-out set #2, g19, timed
// out only in the eval harness, which used to wait the cap out).
import { test } from "node:test";
import assert from "node:assert/strict";
import { webExtract, webSearch } from "../lib/sources/web.ts";

test("a keyless 429 fails the web search at once instead of waiting out Retry-After", async () => {
  const real = globalThis.fetch;
  const saved = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  process.env.TAGOUT_SPEND_GUARD = "off";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: "hourly_cap_reached" } }), { status: 429, headers: { "retry-after": "1196", "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const t0 = Date.now();
    await assert.rejects(webSearch({ query: "Dyson V15 recall" }), /HTTP 429/);
    const pages = await webExtract(["https://www.cpsc.gov/Recalls/2014/example"]);
    assert.equal(pages.size, 0);
    assert.ok(Date.now() - t0 < 2000, "no waiting");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = real;
    if (saved) process.env.TAVILY_API_KEY = saved;
  }
});
