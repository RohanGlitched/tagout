import { NextResponse } from "next/server";
import { newCheckId, type CheckRecord } from "@/lib/checks";
import { saveCheck } from "@/lib/store";
import { isShowcaseWatch, nextRecheckAt } from "@/lib/watch";
import { loadWatch, updateWatch } from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Check again now": queues a full check of the watched list and adds it to the watch, at most once an hour (six
 * hours for a showcase watch); otherwise returns the newest check and when the next one is allowed. The page then
 * runs the queued check like any other, under the same per-visitor and daily budget, except that a showcase
 * watch's check runs on the lite tier (then rules only), never the full one. Opening the watch page runs nothing:
 * the daily sweep does the looking.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await loadWatch(id);
  if (!w) return NextResponse.json({ error: "No watch with that link." }, { status: 404 });
  const showcase = isShowcaseWatch(id);
  const tier = showcase ? "lite" : "full";
  const fresh = newCheckId();
  const at = new Date().toISOString();
  // Claim the slot on the watch first, so two visitors at once queue one check, not two.
  const next = await updateWatch(id, (r) => (nextRecheckAt(r, showcase) === null ? { ...r, checks: [...r.checks, { id: fresh, at }].slice(-30) } : null));
  if (!next) {
    const cur = (await loadWatch(id)) ?? w;
    return NextResponse.json({ checkId: cur.checks.at(-1)?.id, created: false, nextAt: nextRecheckAt(cur, showcase), tier });
  }
  const rec: CheckRecord = { id: fresh, createdAt: at, status: "queued", input: { text: w.text, photoCount: 0 }, photos: [], watchId: id, ...(showcase ? { prefer: "lite" as const } : {}) };
  await saveCheck(rec);
  return NextResponse.json({ checkId: fresh, created: true, nextAt: nextRecheckAt(next, showcase), tier });
}
