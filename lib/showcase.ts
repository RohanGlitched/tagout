import "server-only";
import { unstable_cache } from "next/cache";
import { publicCheck } from "./checks";
import { loadCheck, showcaseChecks } from "./store";

/** The real check the home page shows: SHOWCASE_ID if set, else the newest check marked as a showcase. */
async function load() {
  const id = process.env.SHOWCASE_ID;
  const rec = id ? await loadCheck(id) : (await showcaseChecks())[0] ?? null;
  return rec && rec.status === "done" ? publicCheck(rec) : null;
}

export const showcase = unstable_cache(load, ["showcase-v3"], { revalidate: 600 });
