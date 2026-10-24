import "server-only";
import type { Item, Verdict } from "../types";
import { deadlineScope, modelLabel, MODELS, usageScope, type Usage } from "../nebius";
import { readItems } from "./intake";
import { investigate, type Step } from "./investigate";
import { fillWebText, readNotice } from "./read-notice";
import { buildVerdict, guardGreen } from "./verdict";

/**
 * One check, start to finish, as a stream of events the page renders as they happen:
 * read the list (Nemotron) and photos (vision model) → for each item, Nemotron searches the agency databases and
 * the web with tools → Nemotron reads each relevant notice's model and lot lists, which are verified against the
 * notice text → the deterministic matcher hangs the tag.
 */

/**
 * How a check ran. `readsReused`: notice readings taken from the read cache instead of a model call.
 * `modelUnavailable`: items held back from green because no model answered for them. `lateLite`: items that ran
 * on the lite tier because the check passed its soft deadline. `pagesSkipped`: read_page calls answered without
 * Tavily (a page already read, or one about another brand).
 */
export type Engine = {
  reader?: string;
  agent?: string;
  vision?: string;
  noticeReader?: string;
  planned: "model" | "fixed";
  mode?: "full" | "lite" | "rules";
  tokens?: Usage;
  readsReused?: number;
  modelUnavailable?: number;
  lateLite?: number;
  pagesSkipped?: number;
};

/** After SOFT_MS the remaining items run on the lite tier; after DEADLINE_MS no model call is started. Both sit
 *  well inside the run route's 300 s limit. */
const SOFT_MS = Number(process.env.CHECK_SOFT_DEADLINE_MS || 150_000);
const DEADLINE_MS = Number(process.env.CHECK_DEADLINE_MS || 200_000);

export type Event =
  | { t: "items"; items: Item[]; dropped: number; engine: Engine }
  | { t: "step"; step: Step }
  | { t: "read"; itemId: string; noticeId: string; source: string; codes: number; struck: string[] }
  | { t: "verdict"; verdict: Verdict; planned: "model" | "fixed"; model?: string }
  | { t: "done"; at: string; engine: Engine }
  | { t: "error"; message: string };

/** A tiny async queue so several items can be investigated at once while events stream in order of arrival. */
function channel<T>() {
  const buf: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(v: T) {
      buf.push(v);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        if (buf.length) {
          yield buf.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

/** `agent: false` keeps the model readers but searches by the fixed plan (the eval's "no agent" arm, and the lite
 *  tier); `reader` names the notice reader's model chain for this check. */
export type RunOptions = { agent?: boolean; reader?: string[]; mode?: Engine["mode"] };

/** One check, with every Token Factory call inside it counted onto the engine, under a 200 s overall deadline. */
export async function* runCheck(input: { text: string; photos: string[] }, useModel: boolean, opts: RunOptions = {}): AsyncGenerator<Event> {
  const usage: Usage = { calls: 0, prompt: 0, completion: 0 };
  const t0 = Date.now();
  const ch = channel<Event>();
  usageScope.run(usage, () =>
    deadlineScope.run({ at: t0 + DEADLINE_MS }, () =>
      (async () => {
        for await (const e of run(input, useModel, opts, t0 + SOFT_MS)) ch.push(e);
      })()
        .catch((e) => ch.push({ t: "error", message: (e as Error).message }))
        .finally(() => ch.close()),
    ),
  );
  yield* ch.drain();
}

async function* run(input: { text: string; photos: string[] }, useModel: boolean, opts: RunOptions, softAt: number): AsyncGenerator<Event> {
  const engine: Engine = { planned: useModel && opts.agent !== false ? "model" : "fixed", mode: opts.mode };
  const intake = await readItems(input.text, input.photos, useModel);
  if (intake.model) engine.reader = modelLabel(intake.model);
  if (intake.visionModel) engine.vision = modelLabel(intake.visionModel);
  if (!intake.items.length) {
    yield { t: "error", message: "Nothing in that list looks like a product. Try one thing per line, like “2019 Honda CR-V” or “Graco car seat, model 2074735”." };
    return;
  }
  yield { t: "items", items: intake.items, dropped: intake.dropped, engine };

  const ch = channel<Event>();
  const checkedAt = new Date().toISOString();

  const add = (k: "readsReused" | "modelUnavailable" | "lateLite" | "pagesSkipped", n = 1) => {
    if (n) engine[k] = (engine[k] ?? 0) + n;
  };

  const one = async (item: Item) => {
    try {
      // Past the soft deadline an item that hasn't started runs on the lite tier: the fixed plan, Nano reading.
      const late = Date.now() > softAt;
      if (late && useModel && opts.agent !== false) add("lateLite");
      const agentOn = useModel && opts.agent !== false && !late;
      const chain = late && useModel ? MODELS.lite : opts.reader;
      const inv = await investigate(item, agentOn, (step) => ch.push({ t: "step", step }), { until: softAt });
      if (inv.fallback === "deadline") add("lateLite");
      add("pagesSkipped", (inv.skipped?.repeat ?? 0) + (inv.skipped?.offItem ?? 0));
      if (inv.model) engine.agent = modelLabel(inv.model);
      if (inv.planned === "fixed") engine.planned = "fixed";
      await fillWebText(inv.notices);
      const reads = await Promise.all(inv.notices.map((n) => readNotice(n, useModel, chain)));
      add("readsReused", reads.filter((r) => r.cached).length);
      const reader = reads.find((r) => r.model)?.model;
      if (reader) engine.noticeReader = modelLabel(reader);
      for (const r of reads) {
        if (r.notice.vehicleModel) continue;
        ch.push({ t: "read", itemId: item.id, noticeId: r.notice.id, source: r.notice.source, codes: r.notice.models.length + r.notice.lots.length + r.notice.upcs.length, struck: r.struck });
      }
      const verdict = guardGreen(buildVerdict(item, reads.map((r) => r.notice), inv.searched, checkedAt), {
        mode: opts.mode,
        useModel,
        intake: Boolean(intake.model),
        agent: inv.planned === "model",
        agentFailed: inv.fallback === "error",
        reads: reads.filter((r) => r.model).length,
        readsFailed: reads.filter((r) => r.failed).length,
      });
      if (verdict.degraded) add("modelUnavailable");
      ch.push({ t: "verdict", verdict, planned: inv.planned, model: inv.model ? modelLabel(inv.model) : undefined });
    } catch (e) {
      console.error("[check] item failed", item.id, e);
      ch.push({
        t: "verdict",
        verdict: {
          itemId: item.id,
          level: "warning",
          headline: "The search didn't finish, so this one isn't cleared.",
          proof: [],
          steps: ["Run the check again in a minute. If it keeps failing, search the item at recalls.gov."],
          checkedAt,
          searched: [],
        },
        planned: "fixed",
      });
    }
  };

  // Up to four items at a time keeps Token Factory and the agency APIs inside their rate limits.
  const queue = [...intake.items];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await one(queue.shift()!);
  });
  Promise.all(workers).finally(() => ch.close());
  yield* ch.drain();
  const used = usageScope.getStore();
  if (used?.calls) engine.tokens = { ...used };
  yield { t: "done", at: new Date().toISOString(), engine };
}
