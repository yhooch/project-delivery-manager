import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  McpAuthorizationServerMetadataPath,
  McpCanonicalResourceUriSchema,
  McpEndpointPath,
  McpProtectedResourceMetadataPath,
} from "@project-delivery/shared";

import {
  firstHeaderValue,
  type RequestWithContext,
} from "../../http/request-context";

@Injectable()
export class OAuthConfigService {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  getIssuer(request?: RequestWithContext): string {
    const requestBaseUrl = request ? getRequestBaseUrl(request) : undefined;

    if (requestBaseUrl) {
      return requestBaseUrl;
    }

    const issuer =
      this.config.get<string>("MCP_OAUTH_ISSUER") ??
      this.config.get<string>("API_PUBLIC_URL") ??
      "http://localhost:3001";

    return trimTrailingSlash(issuer);
  }

  getCanonicalResource(request?: RequestWithContext): string {
    const configured = this.config.get<string>("MCP_CANONICAL_RESOURCE_URI");
    const resource = request
      ? `${this.getIssuer(request)}${McpEndpointPath}`
      : (configured ?? `${this.getPublicBaseUrl()}${McpEndpointPath}`);

    return McpCanonicalResourceUriSchema.parse(resource);
  }

  getProtectedResourceMetadataUrl(request?: RequestWithContext): string {
    return `${this.getIssuer(request)}${McpProtectedResourceMetadataPath}`;
  }

  getAuthorizationServerMetadataUrl(request?: RequestWithContext): string {
    return `${this.getIssuer(request)}${McpAuthorizationServerMetadataPath}`;
  }

  getAuthorizationCodeTtlMs(): number {
    return (
      (this.config.get<number>("MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS") ??
        5 * 60) * 1000
    );
  }

  getAccessTokenTtlSeconds(): number {
    return (
      this.config.get<number>("MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS") ??
      60 * 60 * 24
    );
  }

  getRefreshTokenTtlSeconds(): number {
    return (
      this.config.get<number>("MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS") ??
      60 * 60 * 24 * 30
    );
  }

  getClientMetadataTimeoutMs(): number {
    return this.config.get<number>("MCP_CLIENT_METADATA_TIMEOUT_MS") ?? 3000;
  }

  getClientMetadataMaxBytes(): number {
    return (
      this.config.get<number>("MCP_CLIENT_METADATA_MAX_BYTES") ?? 64 * 1024
    );
  }

  getClientMetadataCacheMs(): number {
    return (
      (this.config.get<number>("MCP_CLIENT_METADATA_CACHE_SECONDS") ??
        60 * 60) * 1000
    );
  }

  getPreRegisteredClientsJson(): string {
    return this.config.get<string>("MCP_OAUTH_PRE_REGISTERED_CLIENTS") ?? "[]";
  }

  absoluteUrl(path: string, request?: RequestWithContext): string {
    return `${this.getIssuer(request)}${path}`;
  }

  private getPublicBaseUrl(): string {
    return trimTrailingSlash(
      this.config.get<string>("API_PUBLIC_URL") ?? "http://localhost:3001",
    );
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getRequestBaseUrl(request: RequestWithContext): string | undefined {
  const host = firstHeaderValue(request.headers?.host)?.trim();

  if (!host) {
    return undefined;
  }

  const forwardedProto = firstHeaderValue(
    request.headers?.["x-forwarded-proto"],
  )
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProto || request.protocol || "http";

  return trimTrailingSlash(`${protocol}://${host}`);
}
