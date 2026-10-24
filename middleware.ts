import { NextResponse, type NextRequest } from "next/server";
import { cleanIdPath } from "./lib/clean-path";

/** /check/<id>: and /watch/<id>. (punctuation kept by an autolinker) redirect to the clean link. */
export function middleware(req: NextRequest) {
  const clean = cleanIdPath(req.nextUrl.pathname);
  if (!clean) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = clean;
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: ["/check/:path*", "/watch/:path*", "/api/checks/:path*", "/api/watches/:path*"] };
