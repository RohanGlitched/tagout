import "server-only";
import { storage } from "./storage";

/**
 * Spend guards for the public demo, so visitors can't run up the model bill and the demo still has a model
 * through the judging period (Dec 1-15 2026). Three tiers, all measured in the eval (eval/, /proof):
 * - full: Nemotron 3 Ultra reads the list, runs the search agent and reads every notice. About 2.6 cents of
 *   Nemotron an item. At most FULL_ITEMS_PER_CHECK items of a check (default 5) run on it; the rest run lite.
 * - lite: the fixed search plan with Nemotron 3 Nano reading the notices (Ultra still reads the list). About 0.2
 *   cents an item, 101 of 105 right at ed2dc77 and no recalled unit cleared.
 * - rules: the fixed plan and the matcher with no model at all, and the page says so (never green).
 *
 * Two kinds of allowance decide the tier, and the stricter one wins:
 * - dollars, counted from every Token Factory call (lib/nebius.ts adds each call's list price as it returns,
 *   checks and the daily sweep alike) into one ETag-guarded counter per day in storage. Past DAILY_FULL_USD
 *   (default $1.00) checks run lite; past DAILY_LITE_USD ($1.50), rules only. A running total since the counter
 *   began keeps JUDGING_RESERVE_USD ($6) of SPEND_BALANCE_USD ($15) for the judging period: before JUDGING_FROM
 *   (2026-12-01) checks run rules only once the total reaches the balance less the reserve, and at the balance
 *   itself, always. SPEND_BALANCE_USD=0 turns the total off.
 * - counts, as before: per visitor 12 checks per 10 minutes and IP_DAILY_MODEL_CAP a day on the full tier
 *   (default 40; production sets 15) and DAILY_MODEL_CAP in all (default 400; production 60); then
 *   IP_DAILY_LITE_CAP (30) and DAILY_LITE_CAP (120) on the lite tier.
 * Tavily credits go into the same daily counter (lib/sources/web.ts): DAILY_TAVILY_CREDITS (default 60) on the
 * key, then DAILY_TAVILY_KEYLESS (60) calls in Tavily's keyless mode, then no web search at all that day (the
 * agency databases only; the search step says so).
 * TAGOUT_SPEND_GUARD=off turns the dollar and credit guards off (the eval harness does, so a run is not cut short).
 */
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 12;
const FLUSH_EVERY = 10;

export type Mode = "full" | "lite" | "rules";

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** The dollar and credit allowances, from env (read once per server instance). */
export const SPEND = {
  fullUsd: num(process.env.DAILY_FULL_USD, 1.0),
  liteUsd: num(process.env.DAILY_LITE_USD, 1.5),
  tavilyCredits: num(process.env.DAILY_TAVILY_CREDITS, 60),
  tavilyKeyless: num(process.env.DAILY_TAVILY_KEYLESS, 60),
  balanceUsd: num(process.env.SPEND_BALANCE_USD, 15),
  reserveUsd: num(process.env.JUDGING_RESERVE_USD, 6),
  judgingFrom: process.env.JUDGING_FROM || "2026-12-01",
};
export type SpendConfig = typeof SPEND;

/** Spend on one day: Token Factory dollars at list price, keyed Tavily credits, keyless Tavily calls. */
export type Spend = { usd: number; credits: number; keyless: number };
const ZERO: Spend = { usd: 0, credits: 0, keyless: 0 };
const plus = (a: Spend, b: Partial<Spend>): Spend => ({ usd: a.usd + (b.usd ?? 0), credits: a.credits + (b.credits ?? 0), keyless: a.keyless + (b.keyless ?? 0) });

export const guardOn = () => process.env.TAGOUT_SPEND_GUARD !== "off";

/** The best tier today's dollars allow (pure; `date` is YYYY-MM-DD). */
export function tierCeiling(day: Spend, totalUsd: number, date: string, cfg: SpendConfig = SPEND): Mode {
  if (cfg.balanceUsd > 0) {
    if (totalUsd >= cfg.balanceUsd) return "rules";
    if (date < cfg.judgingFrom && totalUsd >= cfg.balanceUsd - cfg.reserveUsd) return "rules";
  }
  if (day.usd >= cfg.liteUsd) return "rules";
  if (day.usd >= cfg.fullUsd) return "lite";
  return "full";
}

/** How the next Tavily call goes today (pure): on the key, in keyless mode, or not at all. */
export function tavilyMode(day: Spend, cfg: SpendConfig = SPEND): "keyed" | "keyless" | "off" {
  if (day.credits < cfg.tavilyCredits) return "keyed";
  if (day.keyless < cfg.tavilyKeyless) return "keyless";
  return "off";
}

/* ───────────── The daily spend counter: usage/spend-<day>.json, plus usage/spend-total.json ───────────── */

const today = () => new Date().toISOString().slice(0, 10);
const dayKey = (d: string) => `usage/spend-${d}.json`;
const TOTAL_KEY = "usage/spend-total.json";
const READ_EVERY_MS = 20_000;

type DayDoc = Spend & { day: string };
type TotalDoc = { usd: number; credits: number; keyless: number; since: string };

const ledger = { day: "", base: ZERO, local: ZERO, total: 0, readAt: 0 };
let flushing: Promise<void> = Promise.resolve();

async function readJson<T>(key: string): Promise<{ value: T | null; etag?: string }> {
  const s = storage();
  if (!s) return { value: null };
  const r = await s.read(key);
  return r ? { value: JSON.parse(r.text) as T, etag: r.etag } : { value: null };
}

/** Refreshes what other instances have spent (at most every 20 s), and starts a new day at midnight UTC. */
async function sync(force = false): Promise<void> {
  const d = today();
  if (d !== ledger.day) {
    if (ledger.day) await flushSpend().catch(() => {});
    Object.assign(ledger, { day: d, base: ZERO, local: ZERO, readAt: 0 });
  }
  if (!storage() || (!force && Date.now() - ledger.readAt < READ_EVERY_MS)) return;
  const [dayDoc, total] = await Promise.all([readJson<DayDoc>(dayKey(d)), readJson<TotalDoc>(TOTAL_KEY)]);
  ledger.base = dayDoc.value ? plus(ZERO, dayDoc.value) : ZERO;
  ledger.total = total.value?.usd ?? 0;
  ledger.readAt = Date.now();
}

/** Today's spend so far across instances, and the running total in dollars. */
export async function spendNow(): Promise<{ day: Spend; totalUsd: number; date: string }> {
  if (!guardOn()) return { day: ZERO, totalUsd: 0, date: today() };
  await sync().catch((e) => console.error("[budget] spend read failed", (e as Error).message));
  return { day: plus(ledger.base, ledger.local), totalUsd: ledger.total + ledger.local.usd, date: ledger.day || today() };
}

/** Adds spend as it happens (every Token Factory call, every Tavily call); written out every 5¢ or 5 credits. */
export function noteSpend(d: Partial<Spend>): void {
  if (!guardOn()) return;
  if (!ledger.day) ledger.day = today();
  ledger.local = plus(ledger.local, d);
  if (ledger.local.usd >= 0.05 || ledger.local.credits + ledger.local.keyless >= 5) void flushSpend().catch(() => {});
}

/** Writes the unsaved spend into the day's counter and the running total, each under a version check. Callers
 *  await it at the end of a check and of a sweep, so a function that stops right after still counts. */
export function flushSpend(): Promise<void> {
  flushing = flushing.then(write, write);
  return flushing;
}

async function write(): Promise<void> {
  const delta = ledger.local;
  if (!delta.usd && !delta.credits && !delta.keyless) return;
  const d = ledger.day || today();
  ledger.local = ZERO;
  const s = storage();
  if (!s) {
    ledger.base = plus(ledger.base, delta);
    ledger.total += delta.usd;
    return;
  }
  let wroteDay = false;
  try {
    for (let i = 0; i < 4 && !wroteDay; i++) {
      const cur = await readJson<DayDoc>(dayKey(d));
      const next: DayDoc = { day: d, ...plus(cur.value ? plus(ZERO, cur.value) : ZERO, delta) };
      try {
        await s.write(dayKey(d), JSON.stringify(next), { ifMatch: cur.etag });
        if (d === ledger.day) ledger.base = plus(ZERO, next);
        wroteDay = true;
      } catch {
        /* another instance wrote first: read again */
      }
    }
    for (let i = 0; i < 4; i++) {
      const cur = await readJson<TotalDoc>(TOTAL_KEY);
      const t = cur.value ?? { usd: 0, credits: 0, keyless: 0, since: new Date().toISOString() };
      const next: TotalDoc = { ...t, usd: t.usd + delta.usd, credits: t.credits + delta.credits, keyless: t.keyless + delta.keyless };
      try {
        await s.write(TOTAL_KEY, JSON.stringify(next), { ifMatch: cur.etag });
        ledger.total = next.usd;
        break;
      } catch {
        /* retry */
      }
    }
    ledger.readAt = Date.now();
  } catch (e) {
    console.error("[budget] spend write failed", (e as Error).message);
  }
  if (!wroteDay) ledger.local = plus(ledger.local, delta);
}

/** The tier today's dollars allow, right now. */
export async function ceilingNow(): Promise<Mode> {
  if (!guardOn()) return "full";
  const s = await spendNow();
  return tierCeiling(s.day, s.totalUsd, s.date);
}

/** How the next Tavily call goes, right now (the key when there is one and today's credits allow). */
export async function tavilyModeNow(): Promise<"keyed" | "keyless" | "off"> {
  if (!guardOn()) return "keyed";
  return tavilyMode((await spendNow()).day);
}

/* ───────────────────────── Check counts (per visitor and per day) ───────────────────────── */

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

/** A daily count of checks shared across instances through a small counter document in storage. */
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

/** Items of one full-tier check that run on the full tier; the rest run lite (FULL_ITEMS_PER_CHECK, default 5). */
export const FULL_ITEMS_PER_CHECK = Math.max(1, num(process.env.FULL_ITEMS_PER_CHECK, 5));

/** Which tier this visitor's check runs on: full while today's dollars and both full allowances last, then lite,
 *  then rules only. */
export async function takeModelCall(ip: string): Promise<Mode> {
  const ceiling = await ceilingNow();
  if (ceiling === "full" && fullIp(ip) && (await fullDay())) return "full";
  if (ceiling !== "rules" && liteIp(ip) && (await liteDay())) return "lite";
  return "rules";
}

/** The lite tier first, then rules only, never the full tier: a showcase watch's "check again now", so a judge
 *  opening the showcase can't spend the day's Ultra budget. */
export async function takeLiteCall(ip: string): Promise<Mode> {
  if ((await ceilingNow()) !== "rules" && liteIp(ip) && (await liteDay())) return "lite";
  return "rules";
}
