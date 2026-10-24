import type { WatchEvent } from "./sweep/events";

/**
 * Per-watch webhooks: a watch may name one https URL, and the daily sweep POSTs each new event to it as JSON
 * ({ "type": "tagout.watch.event", "watchId", "watch", "event" }), so a property manager's system can turn an
 * alert into a work order. Delivery never holds up the sweep: every POST has a 5-second timeout, failures are
 * counted in the sweep's report and never retried, and redirects are not followed.
 */
export const WEBHOOK_TIMEOUT_MS = 5000;

const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** A URL a watch may deliver to: https, no credentials in it, not a local, private or link-local address. */
export function webhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.test(host)) return null;
  if (host.includes(":") && (host === "::1" || /^(fc|fd|fe80)/.test(host) || host.startsWith("::ffff:"))) return null;
  return u.toString();
}

export type Delivery = { sent: number; failed: number };

/** POSTs each event to the watch's webhook, all at once; resolves within about the timeout and never throws. */
export async function deliverEvents(url: string, watchId: string, events: WatchEvent[], opts: { siteUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<Delivery> {
  const f = opts.fetchImpl ?? fetch;
  const results = await Promise.allSettled(
    events.map((event) => {
      // A timer of its own (AbortSignal.timeout's doesn't keep a short-lived job alive until it fires).
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS);
      return f(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Tagout-Webhook/1" },
        body: JSON.stringify({ type: "tagout.watch.event", watchId, watch: opts.siteUrl ? `${opts.siteUrl}/watch/${watchId}` : undefined, event }),
        redirect: "manual",
        signal: ctl.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        })
        .finally(() => clearTimeout(timer));
    }),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  return { sent: results.length - failed, failed };
}
