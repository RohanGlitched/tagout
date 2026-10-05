import "server-only";
import type { Item, Verdict } from "../types";
import { modelLabel } from "../nebius";
import { readItems } from "./intake";
import { investigate, type Step } from "./investigate";
import { readNotice } from "./read-notice";
import { buildVerdict } from "./verdict";

/**
 * One check, start to finish, as a stream of events the page renders as they happen:
 * read the list (Nemotron) and photos (vision model) → for each item, Nemotron searches the agency databases and
 * the web with tools → Nemotron reads each relevant notice's model and lot lists, which are verified against the
 * notice text → the deterministic matcher hangs the tag.
 */

export type Engine = { reader?: string; agent?: string; vision?: string; planned: "model" | "fixed" };

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

export async function* runCheck(input: { text: string; photos: string[] }, useModel: boolean): AsyncGenerator<Event> {
  const engine: Engine = { planned: useModel ? "model" : "fixed" };
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

  const one = async (item: Item) => {
    try {
      const inv = await investigate(item, useModel, (step) => ch.push({ t: "step", step }));
      if (inv.model) engine.agent = modelLabel(inv.model);
      if (inv.planned === "fixed") engine.planned = "fixed";
      const reads = await Promise.all(inv.notices.map((n) => readNotice(n, useModel)));
      for (const r of reads) {
        if (r.notice.vehicleModel) continue;
        ch.push({ t: "read", itemId: item.id, noticeId: r.notice.id, source: r.notice.source, codes: r.notice.models.length + r.notice.lots.length + r.notice.upcs.length, struck: r.struck });
      }
      const verdict = buildVerdict(
        item,
        reads.map((r) => r.notice),
        inv.searched,
        checkedAt,
      );
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
  yield { t: "done", at: new Date().toISOString(), engine };
}
