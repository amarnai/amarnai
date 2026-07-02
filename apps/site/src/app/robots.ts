import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

// Emitted as a static /robots.txt by the export build.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
