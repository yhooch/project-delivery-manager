import { lookup } from "node:dns/promises";

import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OAuthClientMetadataService,
  isBlockedIpAddress,
  isBlockedMetadataHostname,
} from "./oauth-client-metadata.service";
import { OAuthConfigService } from "./oauth-config.service";
import { MCP_SCOPE_VALUES } from "./oauth-scopes";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]),
}));

const lookupMock = vi.mocked(lookup);

describe("OAuth client metadata SSRF filters", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

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

  it("treats omitted metadata scopes as all supported MCP scopes", async () => {
    const clientId = "https://client.example.com/metadata.json";
    const service = new OAuthClientMetadataService(createOAuthConfig());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: "Metadata Client",
            redirect_uris: ["http://localhost/callback"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
          { status: 200 },
        );
      }),
    );

    const client = await service.fetchMetadataDocument(clientId, new Date());

    expect(lookupMock).toHaveBeenCalledWith("client.example.com", {
      all: true,
      verbatim: false,
    });
    expect(client?.scopes).toEqual([...MCP_SCOPE_VALUES]);
  });
});

function createOAuthConfig(): OAuthConfigService {
  const config = {
    get: (key: string) => {
      if (key === "MCP_CLIENT_METADATA_TIMEOUT_MS") {
        return 3000;
      }

      if (key === "MCP_CLIENT_METADATA_MAX_BYTES") {
        return 64 * 1024;
      }

      if (key === "MCP_CLIENT_METADATA_CACHE_SECONDS") {
        return 3600;
      }

      return undefined;
    },
  } as ConfigService;

  return new OAuthConfigService(config);
}
