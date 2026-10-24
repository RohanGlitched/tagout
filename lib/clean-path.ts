/**
 * Devpost's autolinker (and chat apps, and people) keep the punctuation after a link: "/watch/5ehharz7sr:" and
 * "/check/vk9vuyk3zi." were 404s on the submission page. A check or watch id is 10 characters [a-z0-9]; anything
 * after it in the same path segment that is only punctuation is dropped, and the rest of the path is kept.
 * Returns the clean path, or null when the path is already clean (or isn't a check or watch path).
 */
const ID_PATH = /^\/(check|watch|api\/checks|api\/watches)\/([a-z0-9]{10})([:.,;!?)\]}>'"`’”»\s*]+)(\/.*)?$/;

export function cleanIdPath(pathname: string): string | null {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    /* a malformed escape: match what's there */
  }
  const m = p.match(ID_PATH);
  if (!m) return null;
  return `/${m[1]}/${m[2]}${m[4] ?? ""}`;
}
