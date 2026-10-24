import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import Header from "@/components/chrome/Header";
import Footer from "@/components/chrome/Footer";
import CheckRoom from "@/components/check/CheckRoom";
import { publicCheck } from "@/lib/checks";
import { loadCheck } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A finished check never changes, so it is read from storage once and served from the data cache after that.
 *  Anything still running throws here, which unstable_cache doesn't store, and is read fresh below. */
const finished = unstable_cache(
  async (id: string) => {
    const rec = await loadCheck(id);
    if (!rec || rec.status !== "done") throw new Error("not finished");
    return rec;
  },
  ["check-done-v1"],
  { revalidate: 7 * 86400 },
);

const getCheck = cache(async (id: string) => {
  try {
    return await finished(id);
  } catch {
    return loadCheck(id);
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const rec = await getCheck((await params).id);
  return { title: rec ? "Your check" : "Check not found", robots: { index: false } };
}

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const rec = await getCheck((await params).id);
  if (!rec) notFound();
  return (
    <>
      <Header />
      <CheckRoom initial={publicCheck(rec)} />
      <Footer />
    </>
  );
}
