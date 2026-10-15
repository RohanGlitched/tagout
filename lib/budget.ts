import "server-only";
import { storage } from "./storage";

/**
 * Spend guards for the public demo, so visitors can't run up the model bill. Two tiers, both measured in the
 * eval (eval/, /proof):
 * - full: Nemotron 3 Ultra reads the list, runs the search agent and reads every notice. About 2.6 cents an item
 *   (104 of 105 cases right). Per visitor: 12 checks per 10 minutes and IP_DAILY_MODEL_CAP a day (default 40;
 *   production sets 15). In all: DAILY_MODEL_CAP checks a day (default 400; production sets 60).
 * - lite: once either full cap is spent, the fixed search plan runs with Nemotron 3 Nano reading the notices
 *   (Ultra still reads the list). About 0.3 cents an item, 98 of 105 right and no recalled unit cleared.
 *   IP_DAILY_LITE_CAP (default 30) per visitor and DAILY_LITE_CAP (default 120) in all.
 * - rules: past both, the fixed plan and the matcher run with no model at all, and the page says so.
 * Daily counts live in memory and are flushed to storage every 10 checks (every check once 80% is spent), so the
 * caps hold across server instances.
 */
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 12;
const FLUSH_EVERY = 10;

export type Mode = "full" | "lite" | "rules";

/** A per-address allowance kept in memory per server instance: a short window and a daily total. */
function perIp(dayLimit: number) {
  const calls = new Map<string, number[]>();
  return (ip: string): boolean => {
    const now = Date.now();
    const list = (calls.get(ip) ?? []).filter((t) => now - t < 86_400_000);
    const recent = list.filter((t) => now - t < IP_WINDOW_MS);
    if (recent.length >= IP_LIMIT || list.length >= dayLimit) {
      calls.set(ip, list);
      return false;
    }
    list.push(now);
    calls.set(ip, list);
    if (calls.size > 5000) {
      // Forget the quiet addresses, not everyone.
      for (const [k, v] of calls) if (!v.some((t) => now - t < IP_WINDOW_MS)) calls.delete(k);
    }
    return true;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** A daily total shared across instances through a small counter document in storage. */
function daily(name: string, cap: number) {
  let day = "";
  let persisted = 0; // count stored when we last synced
  let local = 0; // checks this instance took since then
  const key = (d: string) => (name ? `usage/${name}-${d}.json` : `usage/${d}.json`);

  async function readCount(d: string): Promise<{ count: number; etag?: string }> {
    const s = storage();
    if (!s) return { count: 0 };
    const r = await s.read(key(d)).catch(() => null);
    if (!r) return { count: 0 };
    const j = JSON.parse(r.text) as { count: number };
    return { count: j.count ?? 0, etag: r.etag };
  }

  async function flush(): Promise<void> {
    const s = storage();
    if (!s || local === 0) return;
    for (let i = 0; i < 3; i++) {
      const cur = await readCount(day);
      try {
        await s.write(key(day), JSON.stringify({ count: cur.count + local }), { ifMatch: cur.etag });
        persisted = cur.count + local;
        local = 0;
        return;
      } catch {
        /* someone else wrote first: re-read and retry */
      }
    }
  }

  /** Takes one check from today's allowance; false when it's spent. */
  return async (): Promise<boolean> => {
    const d = today();
    if (d !== day) {
      const count = (await readCount(d).catch(() => ({ count: 0 }))).count;
      if (d !== day) {
        day = d;
        local = 0;
        persisted = count;
      }
    }
    if (persisted + local >= cap) return false;
    local++;
    // Sync every 10 checks, and on every check once the day is 80% spent, so instances can't overshoot by much.
    if (local >= FLUSH_EVERY || persisted + local >= cap * 0.8) await flush().catch(() => {});
    return true;
  };
}

const fullIp = perIp(Number(process.env.IP_DAILY_MODEL_CAP || 40));
const fullDay = daily("", Number(process.env.DAILY_MODEL_CAP || 400));
const liteIp = perIp(Number(process.env.IP_DAILY_LITE_CAP || 30));
const liteDay = daily("lite", Number(process.env.DAILY_LITE_CAP || 120));

/** Which tier this visitor's check runs on: full while both full allowances last, then lite, then rules only. */
export async function takeModelCall(ip: string): Promise<Mode> {
  if (fullIp(ip) && (await fullDay())) return "full";
  if (liteIp(ip) && (await liteDay())) return "lite";
  return "rules";
}
