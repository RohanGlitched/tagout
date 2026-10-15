import { NextResponse } from "next/server";
import { CHECK_ID, newCheckId } from "@/lib/checks";
import { loadCheck } from "@/lib/store";
import { clientIp } from "@/lib/visitor";
import type { WatchRecord } from "@/lib/watch";
import { saveWatch } from "@/lib/watches";

export const runtime = "nodejs";

const WINDOW = 10 * 60_000;
const LIMIT = 6;
const recent = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW);
  if (list.length >= LIMIT) return false;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < WINDOW)) recent.delete(k);
  return true;
}

/** Starts watching a finished check's list: the watch begins with that check as its first one. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { checkId?: unknown } | null;
  const checkId = typeof body?.checkId === "string" && CHECK_ID.test(body.checkId) ? body.checkId : null;
  if (!checkId) return NextResponse.json({ error: "That isn't a check link." }, { status: 400 });
  const check = await loadCheck(checkId);
  if (!check) return NextResponse.json({ error: "No check with that link." }, { status: 404 });
  if (check.status !== "done") return NextResponse.json({ error: "Wait for the check to finish, then watch it." }, { status: 409 });
  if (!check.input.text.trim()) return NextResponse.json({ error: "Photos aren't kept after a check, so a photo-only check can't be watched. Type the things instead." }, { status: 422 });
  if (!allowed(await clientIp())) return NextResponse.json({ error: "That's a lot of watches in a few minutes. Try again in ten minutes." }, { status: 429 });
  const rec: WatchRecord = { id: newCheckId(), createdAt: new Date().toISOString(), text: check.input.text, checks: [{ id: check.id, at: check.finishedAt ?? check.createdAt }] };
  await saveWatch(rec);
  return NextResponse.json({ id: rec.id });
}
