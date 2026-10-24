import type { CheckRecord } from "@/lib/checks";
import { AGENCY, noticeRef } from "@/lib/format";
import type { Item, Proof, Source, TagLevel } from "@/lib/types";

/** One line of an item's trace in the hero replay. `at` is a fraction of the replay, 0 to 1. */
export type ReplayLine = { at: number; kind: "search" | "read" | "match"; source?: Source; text: string; found?: number; ok?: boolean };

export type ReplayRow = {
  item: Item;
  level: TagLevel;
  headline: string;
  line?: string;
  marks: Partial<Record<Proof["field"], "match">>;
  hits: string[];
  lines: ReplayLine[];
  /** When the tag is hung, as a fraction of the replay. */
  tagAt: number;
};

export type Replay = {
  id: string;
  createdAt: string;
  items: number;
  seconds: number;
  calls?: number;
  agent?: string;
  rows: ReplayRow[];
};

const SHORT: Partial<Record<string, string>> = {
  search_cpsc: "CPSC recalls",
  search_fda: "FDA recalls",
  search_vehicle_recalls: "NHTSA vehicle recalls",
  search_car_seat_recalls: "NHTSA car seat recalls",
  search_fsis: "USDA FSIS recalls",
  search_web: "Tavily web search",
  read_page: "Tavily extract",
};

/**
 * Turns a finished check's saved log into a replay: every tool call and notice read for the chosen items, in the
 * order the agent made them, spread over the replay's length. The order is real; the clock is compressed.
 */
export function buildReplay(rec: Pick<CheckRecord, "id" | "createdAt" | "startedAt" | "finishedAt" | "log" | "items" | "verdicts" | "engine">, pick: string[]): Replay | null {
  const log = rec.log ?? [];
  if (!log.length || !rec.items || !rec.verdicts) return null;
  const last = log.length;
  // Searches fill the first 80% of the replay; each item's verdict lands just after its own last event.
  const pos = (i: number) => 0.04 + (0.76 * i) / Math.max(1, last - 1);
  const rows: ReplayRow[] = [];
  for (const id of pick) {
    const item = rec.items.find((x) => x.id === id);
    const v = rec.verdicts.find((x) => x.itemId === id);
    if (!item || !v) continue;
    const lines: ReplayLine[] = [];
    let reads = 0;
    let lastAt = 0;
    log.forEach((e, i) => {
      if (e.t === "step" && e.step.itemId === id) {
        const at = pos(i);
        lastAt = at;
        // Repeated empty web searches add nothing to read; keep the first of each tool and every one that found something.
        const name = SHORT[e.step.tool] ?? e.step.label;
        if (!e.step.found && lines.some((l) => l.kind === "search" && l.text === name)) return;
        lines.push({ at, kind: "search", source: e.step.source, text: name, found: e.step.found });
      } else if (e.t === "read" && e.itemId === id) {
        lastAt = pos(i);
        reads++;
      }
    });
    if (reads) {
      const lead = v.notice ? noticeRef(v.notice) : undefined;
      lines.push({ at: Math.min(lastAt, 0.84), kind: "read", source: v.notice?.source, text: reads === 1 && lead ? `Read ${lead}` : `Read ${reads} notices${lead ? `, led by ${lead}` : ""}` });
    }
    const matched = v.proof.filter((p) => p.matched);
    const match =
      v.level === "danger" && matched.length
        ? `${matched[0].yours} is on the recall's list`
        : v.level === "warning"
          ? matched.length
            ? `${matched.map((p) => p.yours).join(", ")} matches; your unit isn't confirmed`
            : "The product line is recalled"
          : "No recall lists this model";
    const tagAt = Math.min(0.97, lastAt + 0.06);
    lines.push({ at: tagAt - 0.02, kind: "match", text: match, ok: v.level === "inspected" });
    const marks: ReplayRow["marks"] = {};
    if (v.level === "danger") for (const p of matched) marks[p.field] = "match";
    rows.push({
      item,
      level: v.level,
      headline: v.headline,
      line: v.notice ? noticeRef(v.notice) : undefined,
      marks,
      hits: matched.map((p) => p.yours),
      lines: lines.slice(-5),
      tagAt,
    });
  }
  const t0 = Date.parse(rec.startedAt ?? rec.createdAt);
  const t1 = Date.parse(rec.finishedAt ?? "");
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    items: rec.items.length,
    seconds: Number.isFinite(t1 - t0) ? Math.round((t1 - t0) / 1000) : 0,
    calls: rec.engine?.tokens?.calls,
    agent: rec.engine?.agent,
    rows,
  };
}

export const SOURCE_NAME = (s?: Source) => (s ? (s === "web" ? "Web" : AGENCY[s]) : "");
