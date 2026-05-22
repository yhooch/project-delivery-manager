import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Inject, Injectable } from "@nestjs/common";
import {
  McpOAuthClientMetadataDocumentSchema,
  McpOAuthRedirectUriSchema,
  type McpScope,
} from "@project-delivery/shared";
import { z } from "zod";

import { OAuthConfigService } from "./oauth-config.service";
import { MCP_SCOPE_VALUES, McpScopeRuntimeSchema } from "./oauth-scopes";

const ALL_MCP_SCOPES = MCP_SCOPE_VALUES;

const PreRegisteredClientSchema = z
  .object({
    clientId: z.string().min(1).max(200),
    clientName: z.string().min(1).max(120),
    clientUri: z.string().url().optional(),
    logoUri: z.string().url().optional(),
    redirectUris: z.array(McpOAuthRedirectUriSchema).min(1),
    scopes: z.array(McpScopeRuntimeSchema).min(1),
  })
  .strict();

const PreRegisteredClientListSchema = z.array(PreRegisteredClientSchema);

export type MetadataClientRegistration = {
  clientId: string;
  clientName: string;
  clientUri?: string;
  logoUri?: string;
  redirectUris: string[];
  scopes: McpScope[];
  metadataDocumentUri: string;
  metadataDocumentFetchedAt: Date;
  metadataDocumentExpiresAt: Date;
};

export type PreRegisteredClientRegistration = z.infer<
  typeof PreRegisteredClientSchema
>;

@Injectable()
export class OAuthClientMetadataService {
  constructor(
    @Inject(OAuthConfigService)
    private readonly oauthConfig: OAuthConfigService,
  ) {}

  findPreRegisteredClient(
    clientId: string,
  ): PreRegisteredClientRegistration | undefined {
    const parsedJson = parseJson(this.oauthConfig.getPreRegisteredClientsJson());
    const result = PreRegisteredClientListSchema.safeParse(parsedJson);

    if (!result.success) {
      throw new Error("Invalid MCP_OAUTH_PRE_REGISTERED_CLIENTS");
    }

    return result.data.find((client) => client.clientId === clientId);
  }

  async fetchMetadataDocument(
    clientId: string,
    now: Date,
  ): Promise<MetadataClientRegistration | undefined> {
    const url = parseMetadataUrl(clientId);

    if (!url) {
      return undefined;
    }

    await assertSafeMetadataUrl(url);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(this.oauthConfig.getClientMetadataTimeoutMs()),
    });

    if (!response.ok) {
      throw new Error("OAuth client metadata document request failed");
    }

    const text = await readLimitedText(
      response,
      this.oauthConfig.getClientMetadataMaxBytes(),
    );
    const documentResult = McpOAuthClientMetadataDocumentSchema.safeParse(
      JSON.parse(text) as unknown,
    );

    if (!documentResult.success) {
      throw new Error("OAuth client metadata document is invalid");
    }

    const document = documentResult.data;

    if (document.client_id !== clientId) {
      throw new Error("OAuth client metadata client_id mismatch");
    }

    if (
      !document.grant_types.includes("authorization_code") ||
      !document.grant_types.includes("refresh_token") ||
      !document.response_types.includes("code")
    ) {
      throw new Error("OAuth client metadata grant types are unsupported");
    }

    return {
      clientId,
      clientName: document.client_name,
      clientUri: document.client_uri,
      logoUri: document.logo_uri,
      redirectUris: document.redirect_uris,
      scopes: parseMetadataScopes(document.scope),
      metadataDocumentUri: url.toString(),
      metadataDocumentFetchedAt: now,
      metadataDocumentExpiresAt: new Date(
        now.getTime() + this.oauthConfig.getClientMetadataCacheMs(),
      ),
    };
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Invalid MCP_OAUTH_PRE_REGISTERED_CLIENTS JSON");
  }
}

function parseMetadataUrl(clientId: string): URL | undefined {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

async function assertSafeMetadataUrl(url: URL): Promise<void> {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    isBlockedMetadataHostname(url.hostname)
  ) {
    throw new Error("OAuth client metadata URL is not allowed");
  }

  if (isIP(stripIpv6Brackets(url.hostname)) !== 0) {
    assertPublicIpAddress(stripIpv6Brackets(url.hostname));
    return;
  }

  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: false,
  });

  if (addresses.length === 0) {
    throw new Error("OAuth client metadata host did not resolve");
  }

  for (const address of addresses) {
    assertPublicIpAddress(address.address);
  }
}

export function isBlockedMetadataHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();

  return (
    normalized.length === 0 ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

function assertPublicIpAddress(address: string): void {
  if (isBlockedIpAddress(address)) {
    throw new Error("OAuth client metadata IP address is not allowed");
  }
}

export function isBlockedIpAddress(address: string): boolean {
  const ipVersion = isIP(address);

  if (ipVersion === 4) {
    return isBlockedIpv4(address);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6(address);
  }

  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [first, second] = parts;

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
    first === undefined ||
    second === undefined
  ) {
    return true;
  }

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 192 && second === 0 ||
    first === 192 && second === 2 ||
    first === 198 && (second === 18 || second === 19) ||
    first === 198 && second === 51 ||
    first === 203 && second === 0 ||
    first >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      throw new Error("OAuth client metadata document is too large");
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseMetadataScopes(scope: string | undefined): McpScope[] {
  if (!scope) {
    return ["mcp:read"];
  }

  const scopes = scope.split(/\s+/u).filter(Boolean);

  if (scopes.length === 0) {
    return ["mcp:read"];
  }

  return scopes.filter((scopeValue): scopeValue is McpScope =>
    ALL_MCP_SCOPES.includes(scopeValue as McpScope),
  );
}
