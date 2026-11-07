import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The on-disk dev cache kept serving stale globals.css through the Tailwind loader below, even
    // across restarts, so `next dev` rebuilds from scratch each start.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
