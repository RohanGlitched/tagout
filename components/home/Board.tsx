"use client";

import { useEffect, useRef, useState } from "react";
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
};

/**
 * The hero: a real household's labels laid on the bench. When the board is mostly in view, each tag is hung in
 * turn, red ones first, as if the check had just ruled on them.
 */
export default function Board({ entries, caption }: { entries: BoardEntry[]; caption?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hung, setHung] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setHung(true);
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={s.board} data-count={entries.length}>
      {entries.map((e, i) => (
        <div key={e.item.id} className={s.slot} data-i={i}>
          <Tagged
            item={e.item}
            level={hung ? e.level : undefined}
            marks={hung ? e.marks : undefined}
            swing
            delay={250 + i * 650}
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
      {caption ? <p className={s.caption}>{caption}</p> : null}
    </div>
  );
}
