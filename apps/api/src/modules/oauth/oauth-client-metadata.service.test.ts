import { describe, expect, it } from "vitest";

import {
  isBlockedIpAddress,
  isBlockedMetadataHostname,
} from "./oauth-client-metadata.service";

describe("OAuth client metadata SSRF filters", () => {
  it("blocks localhost-style hostnames", () => {
    expect(isBlockedMetadataHostname("localhost")).toBe(true);
    expect(isBlockedMetadataHostname("client.local")).toBe(true);
    expect(isBlockedMetadataHostname("client.example.com")).toBe(false);
  });

  it("blocks private, loopback, and documentation IP ranges", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.1.2.3")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.10")).toBe(true);
    expect(isBlockedIpAddress("203.0.113.10")).toBe(true);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
  });
});
