import { NextResponse } from "next/server";
import { newCheckId, type CheckRecord } from "@/lib/checks";
import { saveCheck } from "@/lib/store";
import { due } from "@/lib/watch";
import { loadWatch, updateWatch } from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs a watched list again, at most once a day: when the newest check is more than a day old, a new check of
 * the same list is queued and added to the watch; otherwise the newest check is returned. The page then runs the
 * queued check like any other, under the same per-visitor and daily model budget.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await loadWatch(id);
  if (!w) return NextResponse.json({ error: "No watch with that link." }, { status: 404 });
  const fresh = newCheckId();
  const at = new Date().toISOString();
  // Claim the slot on the watch first, so two visitors at once queue one check, not two.
  const next = await updateWatch(id, (r) => (due(r) ? { ...r, checks: [...r.checks, { id: fresh, at }].slice(-30) } : null));
  if (!next) {
    const cur = (await loadWatch(id)) ?? w;
    return NextResponse.json({ checkId: cur.checks.at(-1)?.id, created: false });
  }
  const rec: CheckRecord = { id: fresh, createdAt: at, status: "queued", input: { text: w.text, photoCount: 0 }, photos: [] };
  await saveCheck(rec);
  return NextResponse.json({ checkId: fresh, created: true });
}
