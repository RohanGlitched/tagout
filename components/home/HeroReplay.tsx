"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Label from "@/components/label/Label";
import Tag from "@/components/tag/Tag";
import { fmtDate } from "@/lib/format";
import { SOURCE_NAME, type Replay } from "./replay";
import s from "./replay.module.css";

/** How long the replay takes, whatever the real run took. */
const LENGTH = 4200;

/**
 * The hero: a real check, replayed from its saved log. Each tool call the agent made appears in the order it made
 * it, the notices are read, the code on the label is matched, and the tag is hung. The clock shows the agent's
 * real time; the replay itself is compressed to a few seconds and plays once, or again on request.
 */
export default function HeroReplay({ replay }: { replay: Replay }) {
  const [t, setT] = useState(0);
  const [run, setRun] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / LENGTH);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setT(0);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [run]);

  const secs = Math.round(t * replay.seconds);
  const done = t >= 1;

  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div className={s.title}>
          <b>A real check, replayed</b>
          <span>
            {fmtDate(replay.createdAt)}, {replay.items} things{replay.agent ? `, ${replay.agent} on Nebius Token Factory` : ""}
          </span>
        </div>
        <div className={s.clock} aria-hidden="true">
          <span className={s.time}>
            0:{String(secs).padStart(2, "0")}
          </span>
          <span className={s.of}>of {replay.seconds} s</span>
        </div>
        <button type="button" className={s.again} onClick={() => setRun((r) => r + 1)} disabled={!done} aria-label="Replay the check">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M12.5 1.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Replay
        </button>
        <div className={s.progress} aria-hidden="true">
          <i style={{ transform: `scaleX(${t})` }} />
        </div>
      </div>

      <ol className={s.rows} aria-label="The check's steps">
        {replay.rows.map((r) => {
          const hung = t >= r.tagAt;
          return (
            <li key={r.item.id} className={s.row} data-level={r.level} data-hung={hung || undefined}>
              <div className={s.plate}>
                <Label item={r.item} marks={hung ? r.marks : undefined} hits={r.hits} />
              </div>
              <ul className={s.trace}>
                {r.lines.map((l, i) => (
                  <li key={i} className={s.line} data-kind={l.kind} data-on={t >= l.at || undefined} data-ok={l.ok || undefined}>
                    {l.kind === "match" ? (
                      <span className={s.eq} aria-hidden="true">
                        {l.ok ? "≠" : "="}
                      </span>
                    ) : (
                      <span className={s.src} data-source={l.source}>
                        {l.kind === "read" ? "Read" : SOURCE_NAME(l.source)}
                      </span>
                    )}
                    <span className={s.what}>{l.kind === "read" ? l.text.replace(/^Read /, "") : l.text}</span>
                    {l.kind === "search" ? <span className={s.found}>{l.found ?? 0} found</span> : null}
                  </li>
                ))}
              </ul>
              <div className={s.hook}>
                {hung ? (
                  <Tag level={r.level} size="sm" swing rest={r.level === "danger" ? -4 : r.level === "warning" ? 3 : -2}>
                    <b className={s.tagHead}>{r.headline}</b>
                  </Tag>
                ) : (
                  <span className={s.waiting} aria-hidden="true" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className={s.foot}>
        The order is the agent&apos;s own; the clock is sped up. <Link href={`/check/${replay.id}`}>Open the whole check</Link>
      </p>
    </div>
  );
}
