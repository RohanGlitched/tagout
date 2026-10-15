/**
 * An agency's list of many recalls (FSIS's filtered /recalls?f[0]=… pages, the FDA and CPSC recall indexes) is not
 * a notice: a code on it may belong to any recall it lists, so it never stands in for one.
 */
export function isListing(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (/[?&]f(%5B|\[)/i.test(u.search) || /[?&](page|search|keys)=/i.test(u.search)) return true;
    return /\/(recalls|recalls-alerts|recalls-public-health-alerts|safety\/recalls-market-withdrawals-safety-alerts|newsroom\/news-releases|recalls\/recall-list)$/.test(path) || path === "";
  } catch {
    return false;
  }
}
