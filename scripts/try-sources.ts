// Live smoke test of every source client. Usage: npx tsx --conditions=react-server scripts/try-sources.ts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) { const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim().replace(/^"(.*)"$/, "$1"); }
const { searchCpsc, cpscFeed } = await import("../lib/sources/cpsc.ts");
const { decodeVin, vehicleRecalls, childSeatRecalls } = await import("../lib/sources/nhtsa.ts");
const { searchFda } = await import("../lib/sources/fda.ts");
const { webSearch } = await import("../lib/sources/web.ts");
const time = async <T,>(name: string, f: () => Promise<T>) => { const t = Date.now(); try { const r = await f(); console.log(name, Date.now() - t, "ms"); return r; } catch (e) { console.log(name, "FAILED", (e as Error).message); return null; } };
const brief = (n: any) => `${n.source} ${n.id} ${n.date} ${n.title.slice(0, 70)} | models=${n.models.slice(0,4)} lots=${n.lots.slice(0,4)} upcs=${n.upcs.slice(0,2)}`;
const c = await time("cpsc vornado", () => searchCpsc({ title: "Vornado" }));
c?.slice(0, 3).forEach((n) => console.log("  ", brief(n)));
const f = await time("cpsc feed", () => cpscFeed());
console.log("  ", f?.length, f?.[0] && brief(f[0]));
const v = await time("vin", () => decodeVin("5J6RW2H89KL000000"));
console.log("  ", v);
const vr = await time("vehicle", () => vehicleRecalls("Honda", "CR-V", 2019));
vr?.slice(0, 3).forEach((n) => console.log("  ", brief(n), n.urgent ?? ""));
const cs = await time("seats evenflo", () => childSeatRecalls("evenflo"));
cs?.slice(0, 3).forEach((n) => console.log("  ", brief(n)));
const d = await time("fda tylenol lot", () => searchFda({ kind: "drug", lot: "EJA022", brand: "Tylenol" }));
d?.slice(0, 3).forEach((n) => console.log("  ", brief(n), n.url));
const fo = await time("fda food words", () => searchFda({ kind: "food", words: "peanut butter", since: "2026-01-01" }));
fo?.slice(0, 3).forEach((n) => console.log("  ", brief(n)));
const w = await time("tavily", () => webSearch({ query: "space heater recall", days: 30 }));
w?.notices.slice(0, 4).forEach((n) => console.log("  ", brief(n), n.url));
