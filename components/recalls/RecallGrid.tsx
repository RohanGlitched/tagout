"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Notice } from "@/lib/types";
import type { Hazard } from "@/lib/wall";
import { fmtDate, fmtUnits } from "@/lib/format";
import s from "./grid.module.css";

export type Card = Notice & { hz: Hazard; own: string };

const HAZARD: Record<Hazard, string> = {
  fire: "Fire and burns",
  breath: "Entrapment or suffocation",
  ingest: "Choking or swallowing",
  injury: "Falls, cuts, impact",
  shock: "Electric shock",
  other: "Other hazard",
};

type Filter = "all" | "products" | "Drugs" | "Food" | "Devices";

/** The newest recalls as cards: CPSC products with their photo, FDA recalls drawn as a pharmacy label. Filterable by kind. */
export default function RecallGrid({ cards }: { cards: Card[] }) {
  const [f, setF] = useState<Filter>("all");
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: cards.length, products: 0, Drugs: 0, Food: 0, Devices: 0 };
    for (const x of cards) {
      if (x.source === "cpsc") c.products++;
      else if (x.category && x.category in c) c[x.category as Filter]++;
    }
    return c;
  }, [cards]);
  const inFilter = cards.filter((x) => f === "all" || (f === "products" ? x.source === "cpsc" : x.category === f));
  // Newsroom recalls arrive a week before CPSC's database has their photos and details: list them on their own.
  const fresh = inFilter.filter((x) => x.source === "cpsc" && !x.image);
  const shown = inFilter.filter((x) => !(x.source === "cpsc" && !x.image));
  const tabs: [Filter, string][] = [
    ["all", "Everything"],
    ["products", "Products"],
    ["Drugs", "Medicines"],
    ["Food", "Food"],
    ["Devices", "Medical devices"],
  ];

  return (
    <>
      <div className={s.tabs} role="tablist" aria-label="Kind of recall">
        {tabs
          .filter(([k]) => counts[k])
          .map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={f === k} className={s.tab} onClick={() => setF(k)}>
              {label}
              <span>{counts[k]}</span>
            </button>
          ))}
      </div>
      {fresh.length ? (
        <section className={s.fresh} aria-labelledby="fresh-h">
          <h2 id="fresh-h" className={s.freshH}>
            Announced this week
            <span>CPSC newsroom, ahead of its database</span>
          </h2>
          <ul className={s.freshList}>
            {fresh.map((n) => (
              <li key={n.url} data-h={n.hz} className={s.freshRow}>
                <span className={s.dot} aria-hidden="true" />
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
                <span className={s.freshMeta}>{HAZARD[n.hz]}</span>
                <Link className={s.ownSmall} href={`/?own=${encodeURIComponent(n.own)}#check`}>
                  Check yours
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul className={s.grid}>
        {shown.map((n) => (
          <li key={`${n.source}${n.id}${n.url}`} className={s.card} data-h={n.hz}>
            <div className={s.band}>
              <span>{n.source === "fda" ? (n.severity === "Class I" ? "Class I: serious risk" : n.severity ?? "FDA") : HAZARD[n.hz]}</span>
              <span className={s.when}>{fmtDate(n.date)}</span>
            </div>
            {n.image ? (
              <div className={s.photo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </div>
            ) : n.source === "fda" ? (
              <div className={s.rx} aria-hidden="true">
                <span className={s.rxKind}>{n.category === "Drugs" ? "Rx / OTC" : n.category}</span>
                <span className={s.rxName}>{n.title}</span>
                <span className={s.rxNo}>{n.id}</span>
              </div>
            ) : null}
            <div className={s.body}>
              <a href={n.url} target="_blank" rel="noreferrer" className={s.title}>
                {n.source === "fda" ? (n.hazard ?? n.title).replace(/\s*\(Class [I]+\)$/, "") : n.title}
              </a>
              <p className={s.meta}>
                {n.source === "fda" ? `${n.firm ?? "FDA"}. ${n.id}` : [n.id.includes("-") && n.id.length < 8 ? `CPSC ${n.id}` : "CPSC", fmtUnits(n.units)].filter(Boolean).join(". ")}
              </p>
              <Link className={s.own} href={`/?own=${encodeURIComponent(n.own)}#check`}>
                Check if yours is affected
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
