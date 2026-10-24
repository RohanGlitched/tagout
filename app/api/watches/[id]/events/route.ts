import { NextResponse } from "next/server";
import { watchFeed } from "@/lib/sweep/view";
import { loadWatch } from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The watch's event log and automatic-checking status, for the watch page (see lib/sweep/view.ts WatchFeed). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  if (!w) return NextResponse.json({ error: "No watch with that link." }, { status: 404 });
  return NextResponse.json(await watchFeed(w), { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
