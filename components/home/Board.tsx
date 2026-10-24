import Tagged from "@/components/tag/Tagged";
import type { Item, Proof, TagLevel } from "@/lib/types";
import s from "./board.module.css";

export type BoardEntry = {
  item: Item;
  level: TagLevel;
  headline: string;
  line?: string;
  foot?: string;
  marks?: Partial<Record<Proof["field"], "match" | "miss" | "reading">>;
  hits?: string[];
};

/**
 * The hero: a real household's labels hung on the lockout board, each with the tag the check gave it. Everything is
 * in the first frame; the tags only settle on their strings with one short swing, red first.
 */
export default function Board({ entries }: { entries: BoardEntry[] }) {
  return (
    <div className={s.board} data-count={entries.length}>
      {entries.map((e, i) => (
        <div key={e.item.id} className={s.slot} data-i={i}>
          <Tagged
            item={e.item}
            level={e.level}
            marks={e.marks}
            hits={e.hits}
            swing
            delay={80 + i * 120}
            rest={[-4, 3, -2, 5][i % 4]}
            size="sm"
            dx={38}
            dy={48}
            foot={e.foot}
          >
            <b className={s.head}>{e.headline}</b>
            {e.line ? <span className={s.line}>{e.line}</span> : null}
          </Tagged>
        </div>
      ))}
    </div>
  );
}
