import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

const config = nextConfig as NextConfig;

describe("Next config", () => {
  it("proxies the MCP OAuth approval endpoint to the API server", async () => {
    const rewrites = await config.rewrites?.();

    expect(rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: expect.stringMatching(/\/oauth\/authorize\/approve$/u),
          source: "/oauth/authorize/approve",
        }),
      ]),
    );
  });
});
