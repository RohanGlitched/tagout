import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverEvents, webhookUrl } from "../lib/webhook.ts";
import type { WatchEvent } from "../lib/sweep/events.ts";

const ev = (id: string): WatchEvent => ({
  id,
  kind: "new-recall",
  at: "2026-10-23T06:00:00.000Z",
  origin: "sweep",
  level: "danger",
  item: { key: "food:winco hoagie rolls", said: "WinCo hoagie rolls", kind: "food" },
  headline: "UPC 2-70552-00649-2 is listed in this recall.",
  proof: [],
  steps: [],
});

test("webhooks: public https only", () => {
  assert.equal(webhookUrl("https://hooks.example.com/tagout"), "https://hooks.example.com/tagout");
  for (const bad of ["http://hooks.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://user:pw@hooks.example.com/", "https://intranet/x", "ftp://x.example.com", "not a url", 42, ""]) {
    assert.equal(webhookUrl(bad), null, String(bad));
  }
});

test("each new event is POSTed as JSON, failures are counted, and a slow endpoint can't hold the sweep", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const ok = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const r = await deliverEvents("https://hooks.example.com/t", "w123456789", [ev("e1"), ev("e2")], { fetchImpl: ok, siteUrl: "https://tagout-recalls.vercel.app" });
  assert.deepEqual(r, { sent: 2, failed: 0 });
  assert.equal(seen.length, 2);
  assert.deepEqual(Object.keys(seen[0].body as object), ["type", "watchId", "watch", "event"]);
  assert.equal((seen[0].body as { event: WatchEvent }).event.id, "e1");

  const refused = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await deliverEvents("https://hooks.example.com/t", "w", [ev("e1")], { fetchImpl: refused }), { sent: 0, failed: 1 });

  // Never answers: the timeout ends it.
  const hang = ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
  const t0 = Date.now();
  assert.deepEqual(await deliverEvents("https://hooks.example.com/t", "w", [ev("e1"), ev("e2")], { fetchImpl: hang, timeoutMs: 80 }), { sent: 0, failed: 2 });
  assert.ok(Date.now() - t0 < 2000);
});
