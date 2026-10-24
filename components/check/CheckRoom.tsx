"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
export default function CheckRoom({ initial, onDone, embedded = false }: { initial: Pub; onDone?: (rec: Pub) => void; embedded?: boolean }) {
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

  // Tell a watch page when the check it started has finished, so it can show what changed.
  const told = useRef(initial.status === "done");
  useEffect(() => {
    if (rec.status === "done" && !told.current) {
      told.current = true;
      onDone?.(rec);
    }
  }, [rec, onDone]);

  const items: Item[] = rec.items ?? [];
  const verdicts = useMemo(() => new Map((rec.verdicts ?? []).map((v) => [v.itemId, v])), [rec.verdicts]);
  const counts = { danger: 0, warning: 0, inspected: 0 };
  for (const v of verdicts.values()) counts[v.level]++;
  const pending = items.length - verdicts.size;
  const order = { danger: 0, warning: 1, inspected: 2 } as const;
  // Once everything is decided, red first; while running, keep the order the person typed.
  const sorted = rec.status === "done" ? [...items].sort((a, b) => order[verdicts.get(a.id)?.level ?? "inspected"] - order[verdicts.get(b.id)?.level ?? "inspected"]) : items;

  return (
    <Shell embedded={embedded} status={rec.status}>
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
      {!embedded && rec.status === "done" && rec.input.text.trim() ? <WatchOffer checkId={rec.id} photos={rec.input.photoCount} /> : null}
    </Shell>
  );
}

function Shell({ embedded, status, children }: { embedded: boolean; status: Pub["status"]; children: React.ReactNode }) {
  return embedded ? (
    <section className={s.room} data-status={status} data-embedded="">
      {children}
    </section>
  ) : (
    <main className={s.room} data-status={status}>
      {children}
    </main>
  );
}

/** Saved watches live in this browser only, as a convenience; the watch link itself is what matters. */
export const WATCH_KEY = "tagout.watches";
export function rememberWatch(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]") as string[];
    localStorage.setItem(WATCH_KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 5)));
  } catch {}
}

/** Turns a one-off check into a watched list: re-checked on each visit (at most daily), with what changed. */
function WatchOffer({ checkId, photos }: { checkId: string; photos: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function watch() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/watches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkId }) });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error || "The watch couldn't be saved. Try again in a moment.");
      rememberWatch(j.id);
      router.push(`/watch/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className={s.watch} aria-labelledby="watch-h">
      <div>
        <h2 id="watch-h">Watch these things</h2>
        <p>
          Recalls keep coming: CPSC announces new ones every week. Save this list as a watch: every day Tagout compares each new recall with it, and anything that names one of your things shows up on the watch page and in its feed.{photos ? " Photos aren't kept, so only the typed lines are watched." : ""}
        </p>
        {error ? (
          <p className={s.watchError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="button" className={s.watchGo} onClick={watch} disabled={busy}>
        {busy ? "Saving the watch…" : "Watch these things"}
      </button>
    </section>
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
  const tk = e.tokens;
  // Tavily credits: one per search, one per page extracted (as Tavily bills them).
  const web = (rec.log ?? []).filter((x) => x.t === "step" && (x.step.tool === "search_web" || x.step.tool === "read_page")).length;
  // Tokens priced like Ultra when an older check carries no cost of its own.
  const usd = tk ? (tk.usd ?? (tk.prompt * 1 + tk.completion * 3) / 1e6) : 0;
  const roles: [string, string | undefined][] =
    e.mode === "lite" || e.planned === "fixed"
      ? [
          ["Read your list", e.reader],
          ["Read label photos", e.vision],
          ["Planned the searches", "A fixed search plan (no model)"],
          ["Read each notice", e.mode === "lite" ? (e.noticeReader ?? "Nemotron 3 Nano") : e.noticeReader],
        ]
      : [
          ["Read your list", e.reader],
          ["Read label photos", e.vision],
          ["Planned the searches", e.agent],
          ["Read each notice", e.noticeReader ?? e.agent],
        ];
  const extras = [
    e.readsReused ? `${plural(e.readsReused, "notice")} already read by an earlier check, reused` : "",
    e.lateLite ? `${plural(e.lateLite, "item")} ran on the lite tier after the time limit` : "",
    e.modelUnavailable ? `${plural(e.modelUnavailable, "item")} held at orange because no model answered` : "",
  ].filter(Boolean);
  return (
    <section className={s.engine} aria-label="How this check ran">
      <h2>How this check ran</h2>
      <dl className={s.roles}>
        {roles
          .filter(([, m]) => m)
          .map(([role, m]) => (
            <div key={role}>
              <dt>{role}</dt>
              <dd>{m}</dd>
            </div>
          ))}
        <div>
          <dt>Decided the tag</dt>
          <dd>Rules: your codes against each recall&apos;s list, not a model</dd>
        </div>
      </dl>
      <p className={s.cost}>
        {tk?.calls ? (
          <>
            <b>{plural(tk.calls, "call")}</b> to Nebius Token Factory, {((tk.prompt + tk.completion) / 1000).toFixed(0)}k tokens (about {(usd * 100).toFixed(1)}¢ at list price)
          </>
        ) : (
          "No model calls"
        )}
        {web ? (
          <>
            ; <b>{plural(web, "Tavily credit")}</b> (about {(web * 0.8).toFixed(0)}¢)
          </>
        ) : null}
        .{e.mode === "lite" ? " Today's full-agent budget was spent, so this ran on the lite tier: 98 of 105 right in the eval, none cleared." : ""}
      </p>
      {extras.length ? <p className={s.cost}>{extras.join("; ")}.</p> : null}
    </section>
  );
}
