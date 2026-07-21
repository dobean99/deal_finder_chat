import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow a second dev server while another instance holds .next (e.g. one
  // running inside WSL): NEXT_DIST_DIR=.next-alt npx next dev -p 3001
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    // Product images come from marketplace CDNs via the AccessTrade feed.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
