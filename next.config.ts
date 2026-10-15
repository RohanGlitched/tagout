import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The first showcase check was lost with the Blob store on Oct 8 and re-run as kj6iutme8c; the old link is in
  // the judges' brief, the video and older screenshots, so it keeps working.
  async redirects() {
    return [
      { source: "/check/fdjj2pxifw", destination: "/check/kj6iutme8c", permanent: true },
      { source: "/api/checks/fdjj2pxifw", destination: "/api/checks/kj6iutme8c", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
