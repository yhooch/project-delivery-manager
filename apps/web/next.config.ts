import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const apiProxyTarget =
  process.env.API_PROXY_TARGET?.replace(/\/$/u, "") ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.113.64.114", "127.0.0.1", "localhost"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
