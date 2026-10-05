import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Checks are private links; the API is not a page. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/check/", "/api/"] }, sitemap: `${SITE_URL}/sitemap.xml` };
}
