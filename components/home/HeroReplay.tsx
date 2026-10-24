"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  // React re-renders only when the replay crosses one of its events; the clock and the progress bar are written
  // straight to the DOM each frame, so a phone isn't re-rendering three labels sixty times a second.
  const marks = useMemo(() => [...new Set(replay.rows.flatMap((r) => [r.tagAt, ...r.lines.map((l) => l.at)]).concat(1))].sort((a, b) => a - b), [replay]);
  const [t, setT] = useState(0);
  const [run, setRun] = useState(0);
  const raf = useRef(0);
  const clock = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const paint = (p: number) => {
      if (clock.current) clock.current.textContent = `0:${String(Math.round(p * replay.seconds)).padStart(2, "0")}`;
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(1);
      setT(1);
      return;
    }
    const start = performance.now();
    let next = 0;
    setT(0);
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / LENGTH);
      paint(p);
      if (p >= marks[next]) {
        while (next < marks.length && p >= marks[next]) next++;
        setT(p);
      }
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [run, marks, replay.seconds]);

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
          <span className={s.time} ref={clock}>
            0:00
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
          <i ref={bar} style={{ transform: "scaleX(0)" }} />
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
