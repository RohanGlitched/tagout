import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/recalls`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/how`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
