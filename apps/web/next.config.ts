import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@foundry/shared"],
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${process.env.API_URL ?? "http://127.0.0.1:4000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
