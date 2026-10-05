import { NextResponse } from "next/server";
import { runCheck, type Event } from "@/lib/agent/run";
import type { CheckRecord } from "@/lib/checks";
import { takeModelCall } from "@/lib/budget";
import { hasKey } from "@/lib/nebius";
import { loadCheck, updateCheck } from "@/lib/store";
import { clientIp } from "@/lib/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_MS = 4 * 60_000;

/**
 * Runs a queued check and streams its events as NDJSON. Only one caller can claim a check; anyone else gets 409
 * and polls the record. Progress is saved as it arrives, so a reload mid-check picks up where it is.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claimedAt = new Date().toISOString();
  const claimed = await updateCheck(id, (r) => {
    const stale = r.status === "running" && r.startedAt && Date.now() - Date.parse(r.startedAt) > STALE_MS;
    if (r.status !== "queued" && !stale) return null;
    return { ...r, status: "running", startedAt: claimedAt };
  });
  if (!claimed) {
    const rec = await loadCheck(id);
    return NextResponse.json({ error: rec ? "This check is already running or done." : "No check with that link.", status: rec?.status }, { status: rec ? 409 : 404 });
  }

  const useModel = hasKey() && (await takeModelCall(await clientIp()));
  const input = { text: claimed.input.text, photos: claimed.photos ?? [] };
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const acc: Partial<CheckRecord> = { log: [], verdicts: [] };
      let lastSave = 0;
      const save = async (final = false) => {
        const patch = { ...acc };
        await updateCheck(id, (r) => ({ ...r, ...patch, ...(final ? { photos: undefined } : {}) })).catch((e) => console.error("[run] save failed", e));
      };
      try {
        for await (const e of runCheck(input, useModel)) {
          send(e);
          if (e.t === "items") {
            acc.items = e.items;
            acc.dropped = e.dropped;
            acc.engine = e.engine;
            await save();
          } else if (e.t === "step" || e.t === "read") acc.log!.push(e);
          else if (e.t === "verdict") {
            acc.verdicts!.push(e.verdict);
            if (Date.now() - lastSave > 2500) {
              lastSave = Date.now();
              await save();
            }
          } else if (e.t === "done") {
            acc.engine = e.engine;
            acc.status = "done";
            acc.finishedAt = e.at;
          } else if (e.t === "error") {
            acc.status = "failed";
            acc.error = e.message;
          }
        }
        if (!acc.status) acc.status = "done";
      } catch (err) {
        console.error("[run] check failed", err);
        acc.status = "failed";
        acc.error = "The check stopped partway. Run it again in a minute.";
        send({ t: "error", message: acc.error });
      }
      await save(true);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
