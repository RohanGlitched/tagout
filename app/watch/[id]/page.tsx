import { notFound } from "next/navigation";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import WatchRoom from "@/components/watch/WatchRoom";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";
import { loadWatch } from "@/lib/watches";
import { watchFeed } from "@/lib/sweep/view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  return { title: w ? "Watched things" : "Watch not found", robots: { index: false } };
}

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const w = await loadWatch((await params).id);
  if (!w) notFound();
  // The checks this watch has run, newest last; the page compares the newest finished one with the one before.
  const [recs, feed] = await Promise.all([
    Promise.all(w.checks.slice(-6).map((c) => loadCheck(c.id).catch(() => null))).then((rs) => rs.filter((r) => r !== null)),
    watchFeed(w),
  ]);
  return (
    <>
      <Header />
      {/* Opening a watch runs nothing: the daily sweep does the looking (lib/sweep), and "Check again now" is the page's own button. */}
      <WatchRoom watch={w} checks={recs.map(publicCheck)} feed={feed} />
      <Footer />
    </>
  );
}
