import summary from "@/eval/summary.json";
import s from "./ladder.module.css";

/** From the weakest setup to Tagout, each answering the same cases. */
const RUNGS: { arm: string; name: string; note: string }[] = [
  { arm: "alone-ultra", name: "Nemotron from memory", note: "No search. Every recall here is newer than the model." },
  { arm: "search-ultra", name: "Nemotron reading web results", note: "Tavily finds the recall pages; the model decides alone." },
  { arm: "rules", name: "Rules, no model", note: "A fixed search plan and a pattern reader." },
  { arm: "fixed-plan-nano", name: "Lite tier", note: "Fixed plan, Nemotron Nano reads the notices, rules decide." },
  { arm: "tagout", name: "Tagout", note: "Nemotron Ultra agent and readers, rules decide." },
];

/**
 * The eval as a ladder: one tick per case. Dark ticks are right; red ticks are recalled units the setup cleared,
 * orange ticks are things wrongly tagged do not use, pale ticks are other misses.
 */
export default function Ladder() {
  const rows = RUNGS.map((r) => ({ ...r, a: summary.arms.find((x) => x.arm === r.arm) })).filter((r) => r.a);
  return (
    <div className={s.ladder}>
      <ol className={s.rungs}>
        {rows.map(({ arm, name, note, a }) => {
          const n = a!.n;
          const cleared = a!.falseClear.length;
          const falseRed = a!.falseRed.length;
          const other = n - a!.right - cleared - falseRed;
          const ticks = [
            ...Array(a!.right).fill("r"),
            ...Array(Math.max(0, other)).fill("o"),
            ...Array(falseRed).fill("f"),
            ...Array(cleared).fill("c"),
          ];
          return (
            <li key={arm} className={s.rung} data-us={arm === "tagout" || undefined}>
              <div className={s.who}>
                <b>{name}</b>
                <span>{note}</span>
              </div>
              <div className={s.ticks} role="img" aria-label={`${a!.right} of ${n} right, ${cleared} recalled units cleared, ${falseRed} wrongly tagged do not use`}>
                {ticks.map((k, i) => (
                  <i key={i} data-k={k} />
                ))}
              </div>
              <dl className={s.nums}>
                <div>
                  <dt>Right</dt>
                  <dd>
                    {a!.right}
                    <small>/{n}</small>
                  </dd>
                </div>
                <div>
                  <dt>Recalled, cleared</dt>
                  <dd data-bad={cleared > 0 || undefined}>{cleared}</dd>
                </div>
                <div>
                  <dt>Wrongly red</dt>
                  <dd data-warn={falseRed > 0 || undefined}>{falseRed}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
      <p className={s.key}>
        <span>
          <i data-k="r" /> right
        </span>
        <span>
          <i data-k="c" /> a recalled unit cleared
        </span>
        <span>
          <i data-k="f" /> wrongly tagged do not use
        </span>
        <span>
          <i data-k="o" /> other miss
        </span>
      </p>
    </div>
  );
}
