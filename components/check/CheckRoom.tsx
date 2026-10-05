"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckRecord } from "@/lib/checks";
import type { Event } from "@/lib/agent/run";
import type { Item, Verdict } from "@/lib/types";
import { plural } from "@/lib/format";
import Tag from "@/components/tag/Tag";
import ItemRow from "./ItemRow";
import s from "./room.module.css";

type Pub = Omit<CheckRecord, "photos">;
type LogEntry = NonNullable<CheckRecord["log"]>[number];

/**
 * The check as it happens. A queued check is run from here and its events stream in: the list is read, each
 * item's searches appear under it, and its tag is hung when the matcher decides. Anyone else opening the link
 * mid-run polls the saved record instead.
 */
export default function CheckRoom({ initial }: { initial: Pub }) {
  const [rec, setRec] = useState<Pub>(initial);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(initial.status === "failed" ? initial.error ?? "This check didn't finish." : null);
  const started = useRef(false);
  // Local time is only known in the browser; render it after hydration.
  const [when, setWhen] = useState("");
  useEffect(() => setWhen(new Date(initial.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })), [initial.createdAt]);
  // Tags hung during this visit swing; tags that were already decided when the page loaded don't.
  const swingIds = useRef(new Set<string>());

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial.status === "queued") run();
    else if (initial.status === "running") poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function poll() {
    setLive(true);
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`/api/checks/${initial.id}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) continue;
      const next = (await r.json()) as Pub;
      next.verdicts?.forEach((v) => {
        if (!rec.verdicts?.some((x) => x.itemId === v.itemId)) swingIds.current.add(v.itemId);
      });
      setRec(next);
      if (next.status === "done" || next.status === "failed") {
        if (next.status === "failed") setError(next.error ?? "This check didn't finish.");
        break;
      }
    }
    setLive(false);
  }

  async function run() {
    setLive(true);
    setRec((r) => ({ ...r, status: "running" }));
    try {
      const res = await fetch(`/api/checks/${initial.id}/run`, { method: "POST" });
      if (res.status === 409) return poll();
      if (!res.ok || !res.body) throw new Error("The check couldn't start. Reload the page to try again.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) apply(JSON.parse(line) as Event);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLive(false);
    }
  }

  function apply(e: Event) {
    setRec((r) => {
      switch (e.t) {
        case "items":
          return { ...r, items: e.items, dropped: e.dropped, engine: e.engine };
        case "step":
        case "read":
          return { ...r, log: [...(r.log ?? []), e as LogEntry] };
        case "verdict":
          swingIds.current.add(e.verdict.itemId);
          return { ...r, verdicts: [...(r.verdicts ?? []).filter((v) => v.itemId !== e.verdict.itemId), e.verdict] };
        case "done":
          return { ...r, status: "done", finishedAt: e.at, engine: e.engine };
        case "error":
          setError(e.message);
          return { ...r, status: "failed", error: e.message };
      }
    });
  }

  const items: Item[] = rec.items ?? [];
  const verdicts = useMemo(() => new Map((rec.verdicts ?? []).map((v) => [v.itemId, v])), [rec.verdicts]);
  const counts = { danger: 0, warning: 0, inspected: 0 };
  for (const v of verdicts.values()) counts[v.level]++;
  const pending = items.length - verdicts.size;
  const order = { danger: 0, warning: 1, inspected: 2 } as const;
  // Once everything is decided, red first; while running, keep the order the person typed.
  const sorted = rec.status === "done" ? [...items].sort((a, b) => order[verdicts.get(a.id)?.level ?? "inspected"] - order[verdicts.get(b.id)?.level ?? "inspected"]) : items;

  return (
    <main className={s.room}>
      <section className={s.top} aria-live="polite">
        <div className={s.titleCol}>
          <h1 className={s.h1}>{headline(rec.status, items.length, counts, pending)}</h1>
          <p className={s.meta}>
            {items.length ? `${plural(items.length, "thing")} checked against NHTSA, CPSC, FDA and the web` : "Reading your list"}
            {when ? `, ${when}` : ""}.
          </p>
        </div>
        {verdicts.size ? (
          <ul className={s.tally} aria-label="Summary">
            {(["danger", "warning", "inspected"] as const).map((l) =>
              counts[l] ? (
                <li key={l}>
                  <Tag level={l} size="sm" rest={l === "danger" ? -4 : l === "warning" ? 3 : -2} />
                  <b>{counts[l]}</b>
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
      </section>

      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}

      {!items.length && rec.status !== "failed" ? <Reading text={rec.input.text} photos={rec.input.photoCount} /> : null}

      <ol className={s.bench}>
        {sorted.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            verdict={verdicts.get(item.id)}
            log={(rec.log ?? []).filter((l) => (l.t === "step" ? l.step.itemId : l.itemId) === item.id)}
            running={live && !verdicts.has(item.id)}
            swing={swingIds.current.has(item.id)}
          />
        ))}
      </ol>

      {rec.dropped ? (
        <p className={s.note}>
          {plural(rec.dropped, "code")} the reader returned didn&apos;t appear in what you typed, so {rec.dropped === 1 ? "it was" : "they were"} left out.
        </p>
      ) : null}

      <Engine rec={rec} />
    </main>
  );
}

function headline(status: Pub["status"], n: number, c: Record<Verdict["level"], number>, pending: number): string {
  if (status === "failed" && !n) return "This check didn't run.";
  if (!n) return "Reading your list…";
  if (pending > 0) return `Checking ${plural(n, "thing")}…`;
  if (c.danger) return `${c.danger === 1 ? "One thing" : `${c.danger} things`} to stop using.`;
  if (c.warning) return `${c.warning === 1 ? "One thing" : `${c.warning} things`} to check on the label.`;
  return `Nothing you listed is recalled.`;
}

function Reading({ text, photos }: { text: string; photos: number }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <ol className={s.reading} aria-label="Your list">
      {lines.map((l, i) => (
        <li key={i} style={{ animationDelay: `${i * 120}ms` }}>
          <span className="code">{l}</span>
        </li>
      ))}
      {photos ? <li>{plural(photos, "label photo")}</li> : null}
    </ol>
  );
}

function Engine({ rec }: { rec: Pub }) {
  const e = rec.engine;
  if (!e) return null;
  return (
    <section className={s.engine} aria-label="How this check ran">
      <h2>How this check ran</h2>
      {e.planned === "fixed" ? (
        <p>The model was unavailable or today&apos;s demo budget was spent, so this check used Tagout&apos;s fixed search plan. The matcher works the same way.</p>
      ) : (
        <p>
          {e.reader ? `${e.reader} read your list. ` : ""}
          {e.vision ? `${e.vision} read your label photos. ` : ""}
          {e.agent ? `${e.agent} planned the searches and chose the relevant recalls. ` : ""}
          All of it ran on Nebius Token Factory. Tavily searched the web. Whether a tag is red was decided by comparing your codes with each recall&apos;s list, not by a model.
        </p>
      )}
    </section>
  );
}
