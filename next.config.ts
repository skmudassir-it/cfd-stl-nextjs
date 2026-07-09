import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5050";

const nextConfig: NextConfig = {
  transpilePackages: ["three"],
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "5050",
        pathname: "/static/results/**",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/upload",
        destination: `${API_URL}/upload`,
      },
      {
        source: "/api/slice",
        destination: `${API_URL}/slice`,
      },
      {
        source: "/api/simulate",
        destination: `${API_URL}/simulate`,
      },
      {
        source: "/api/static/:path*",
        destination: `${API_URL}/static/:path*`,
      },
    ];
  },
};

export default nextConfig;
