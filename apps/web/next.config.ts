import type { NextConfig } from "next";

const api = process.env.FASTAPI_INTERNAL_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    return api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : [];
  },
};

export default nextConfig;
