import "server-only";

/** GET/POST JSON with a timeout and one retry on network errors and 5xx. Returns null on 404 (openFDA's "no matches"). */
export async function getJson<T>(url: string, init: RequestInit & { timeoutMs?: number; retries?: number } = {}): Promise<T | null> {
  const { timeoutMs = 12_000, retries = 1, ...rest } = init;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json", "user-agent": "Tagout/1.0 (+https://tagout.vercel.app)", ...(rest.headers ?? {}) } });
      if (r.status === 404) return null;
      if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { fatal: true });
      return (await r.json()) as T;
    } catch (e) {
      last = e;
      if ((e as { fatal?: boolean }).fatal) break;
      if (attempt < retries) await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Agencies publish curly quotes that some APIs turn into U+FFFD; put back an apostrophe inside words, quotes elsewhere. */
export function clean(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/(\w)�(\w)/g, "$1’$2")
    .replace(/�/g, '"')
    .replace(/[  ]/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export function firstSentence(s: string, max = 220): string {
  const t = clean(s);
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const one = m ? m[1] : t;
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
}
