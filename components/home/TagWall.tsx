"use client";

import { useEffect, useRef, useState } from "react";
import type { Hazard, Wall } from "@/lib/wall";
import s from "./wall.module.css";

const NAMES: Record<Hazard, string> = {
  fire: "Fire and burns",
  breath: "Entrapment, tip-over, suffocation",
  ingest: "Choking and swallowing",
  injury: "Falls, cuts and impact",
  shock: "Electric shock",
  other: "Poisoning and other",
};
const ORDER: Hazard[] = ["fire", "breath", "ingest", "injury", "shock", "other"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A stable small tilt per tag, so the wall looks hung by hand but renders the same on server and client. */
const tilt = (i: number) => ((((i * 2654435761) >>> 0) % 13) - 6) * 0.9;

/**
 * Every CPSC recall this year as a tag on a rail, one rail per month, coloured by hazard in ANSI safety colours.
 * Pointing at a tag names the recall; a legend entry picks out one hazard. The tooltip is written straight to the
 * DOM so moving across 450 tags doesn't re-render anything.
 */
export default function TagWall({ wall }: { wall: Wall }) {
  const ref = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [pick, setPick] = useState<Hazard | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const flat = wall.months.flatMap((m) => m.tags);

  function point(e: React.PointerEvent | React.FocusEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    const box = tip.current;
    const host = ref.current;
    if (!a || !box || !host) return;
    const tag = flat[Number(a.dataset.i)];
    box.querySelector("b")!.textContent = tag.t;
    box.querySelector("span")!.textContent = `${tag.n ? `CPSC ${tag.n}, ` : ""}${fmt(tag.d)}. ${NAMES[tag.h]}.`;
    const r = a.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const x = Math.min(Math.max(r.left - h.left + r.width / 2, 130), h.width - 130);
    box.style.transform = `translate(${x}px, ${r.top - h.top - 10}px) translate(-50%, -100%)`;
    box.dataset.on = "1";
    box.dataset.h = tag.h;
  }
  const leave = () => tip.current && (tip.current.dataset.on = "");

  let i = 0;
  return (
    <div className={s.wrap}>
      <ul className={s.legend} aria-label="Hazards">
        {ORDER.filter((h) => wall.counts[h]).map((h) => (
          <li key={h}>
            <button type="button" className={s.key} data-h={h} aria-pressed={pick === h} onClick={() => setPick((p) => (p === h ? null : h))}>
              <i className={s.chip} data-h={h} aria-hidden="true" />
              <span>{NAMES[h]}</span>
              <b>{wall.counts[h]}</b>
            </button>
          </li>
        ))}
      </ul>

      <div
        ref={ref}
        className={`${s.wall} ${shown ? s.shown : ""}`}
        data-pick={pick ?? undefined}
        style={{ "--cols": wall.months.length } as React.CSSProperties}
        onPointerOver={point}
        onPointerLeave={leave}
        onFocus={point}
        onBlur={leave}
        role="group"
        aria-label={`${wall.total} CPSC recalls in ${wall.year}, by month and hazard`}
      >
        {wall.months.map((m, mi) => (
          <section key={m.key} className={s.month} style={{ "--m": mi } as React.CSSProperties}>
            <div className={s.rail} aria-hidden="true" />
            <ul className={s.tags}>
              {m.tags.map((t) => {
                const idx = i++;
                return (
                  <li key={idx} style={{ "--r": `${tilt(idx)}deg`, "--d": `${(idx % 40) * 9}ms` } as React.CSSProperties}>
                    <a href={t.u} target="_blank" rel="noreferrer" className={s.tag} data-h={t.h} data-i={idx} tabIndex={-1} aria-label={`${t.t}, ${fmt(t.d)}`} />
                  </li>
                );
              })}
            </ul>
            <h3 className={s.mlabel}>
              {MONTHS[Number(m.key.slice(5, 7)) - 1]}
              <span>{m.tags.length}</span>
            </h3>
          </section>
        ))}
        <div ref={tip} className={s.tip} aria-hidden="true">
          <b />
          <span />
        </div>
      </div>
    </div>
  );
}

function fmt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
