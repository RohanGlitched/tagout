import { atomFeed } from "@/lib/feed";
import { SITE_URL } from "@/lib/site";
import { loadEventLog, loadLatestSweep } from "@/lib/sweep/store";
import { loadWatch } from "@/lib/watches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The watch's Atom feed: subscribe in any feed reader to be told when a new recall covers something on the list. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  if (!w) return new Response("No watch with that link.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const [log, sweep] = await Promise.all([loadEventLog(w.id), loadLatestSweep()]);
  const body = atomFeed({
    site: SITE_URL,
    watchId: w.id,
    createdAt: w.createdAt,
    things: w.text.split("\n").filter((l) => l.trim()).length,
    events: log.events,
    lastSweepAt: sweep && !sweep.skipped ? sweep.finishedAt || sweep.startedAt : undefined,
  });
  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      // Feed readers poll; the sweep runs once a day, so a quarter of an hour at the edge is plenty fresh.
      "cache-control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
      "x-robots-tag": "noindex",
    },
  });
}
