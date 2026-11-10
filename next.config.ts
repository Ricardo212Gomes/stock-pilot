import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The on-disk dev cache kept serving stale globals.css through the Tailwind loader below, even
    // across restarts, so `next dev` rebuilds from scratch each start.
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      // A broker's statement uploaded to the Portfolio's import is a couple of megabytes (the default is 1 MB).
      bodySizeLimit: "10mb",
    },
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
