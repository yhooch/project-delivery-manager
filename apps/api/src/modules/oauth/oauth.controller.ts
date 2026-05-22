import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  McpOAuthAuthorizeQuerySchema,
  McpOAuthDynamicClientRegistrationRequestSchema,
  McpOAuthRevocationRequestSchema,
  McpOAuthTokenRequestSchema,
  RevokeAuthorizedMcpClientRequestSchema,
  type ListAuthorizedMcpClientsResponse,
  type McpOAuthAuthorizeQuery,
  type McpOAuthDynamicClientRegistrationResponse,
  type RevokeAuthorizedMcpClientRequest,
  type RevokeAuthorizedMcpClientResponse,
} from "@project-delivery/shared";
import type { z } from "zod";

import { ApiException } from "../../http/api-exception";
import {
  firstHeaderValue,
  type RequestWithContext,
} from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { WriteOriginGuard } from "../auth/write-origin.guard";
import { OAuthProtocolError } from "./oauth-protocol.error";
import { OAuthConfigService } from "./oauth-config.service";
import { OAuthService } from "./oauth.service";

type RawResponse = {
  redirect(status: number, url: string): void;
  setHeader(name: string, value: string): void;
  status(statusCode: number): RawResponse;
  json(body: unknown): void;
};

const authorizeConsentParam = "consent";
const authorizeConsentValue = "approve";
const webMcpAuthorizePath = "/zh-CN/oauth/mcp/authorize";

@Controller()
export class OAuthDiscoveryController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
  ) {}

  @Get(".well-known/oauth-protected-resource")
  getProtectedResourceMetadata(@Res() response: RawResponse): void {
    response.status(HttpStatus.OK).json(this.oauth.getProtectedResourceMetadata());
  }

  @Get(".well-known/oauth-authorization-server")
  getAuthorizationServerMetadata(@Res() response: RawResponse): void {
    response
      .status(HttpStatus.OK)
      .json(this.oauth.getAuthorizationServerMetadata());
  }
}

@Controller("oauth")
export class OAuthController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(OAuthConfigService)
    private readonly oauthConfig: OAuthConfigService,
  ) {}

  @Get("authorize")
  async authorize(
    @Query() query: unknown,
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): Promise<void> {
    const { approved, oauthQuery } = extractAuthorizeConsent(query);
    const parsed = McpOAuthAuthorizeQuerySchema.safeParse(
      withDefaultResource(oauthQuery, this.oauthConfig.getCanonicalResource()),
    );

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
      return;
    }

    if (!wantsJson(request) && !approved) {
      response.redirect(
        HttpStatus.FOUND,
        buildWebAuthorizeUrl(
          this.config.get<string>("WEB_APP_URL") ?? "http://localhost:3000",
          parsed.data,
        ),
      );
      return;
    }

    if (!request.session) {
      throw new ApiException(
        "UNAUTHORIZED",
        "Authentication is required",
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const prepared = await this.oauth.prepareAuthorization(
        parsed.data,
        request.session.userId,
      );

      if (wantsJson(request)) {
        response.status(HttpStatus.OK).json(prepared.context);
        return;
      }

      const result = await prepared.grant();
      response.redirect(HttpStatus.FOUND, result.redirectTo);
    } catch (error) {
      writeOAuthError(response, error);
    }
  }

  @Post("token")
  @HttpCode(HttpStatus.OK)
  async token(
    @Body() body: unknown,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthTokenRequestSchema.safeParse(
      withDefaultResource(body, this.oauthConfig.getCanonicalResource()),
    );

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
      return;
    }

    try {
      const tokenResponse = await this.oauth.exchangeToken(parsed.data);
      response.status(HttpStatus.OK).json(tokenResponse);
    } catch (error) {
      writeOAuthError(response, error);
    }
  }

  @Post("register")
  async register(
    @Body() body: unknown,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthDynamicClientRegistrationRequestSchema.safeParse(body);

    if (!parsed.success) {
      writeDynamicClientRegistrationValidationError(response, parsed.error);
      return;
    }

    const result: McpOAuthDynamicClientRegistrationResponse =
      await this.oauth.registerDynamicClient(parsed.data);
    response.status(HttpStatus.CREATED).json(result);
  }

  @Post("revoke")
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Body() body: unknown,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthRevocationRequestSchema.safeParse(body);

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
      return;
    }

    try {
      await this.oauth.revokeToken(parsed.data);
      response.status(HttpStatus.OK).json({});
    } catch (error) {
      writeOAuthError(response, error);
    }
  }
}

@Controller("users/me/mcp/authorized-clients")
@UseGuards(RequireSessionGuard)
export class AuthorizedMcpClientsController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get()
  async list(
    @Req() request: RequestWithContext,
  ): Promise<ListAuthorizedMcpClientsResponse> {
    const session = this.currentUser.requireSession(request);
    return this.oauth.listAuthorizedClients(session.userId);
  }

  @Post("revoke")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async revokeClient(
    @Body(new ZodValidationPipe(RevokeAuthorizedMcpClientRequestSchema))
    body: RevokeAuthorizedMcpClientRequest,
    @Req() request: RequestWithContext,
  ): Promise<RevokeAuthorizedMcpClientResponse> {
    const session = this.currentUser.requireSession(request);
    await this.oauth.revokeAuthorizedClient(session.userId, body.clientId);
    return {};
  }
}

function wantsJson(request: RequestWithContext): boolean {
  return firstHeaderValue(request.headers?.accept)?.includes(
    "application/json",
  ) ?? false;
}

function extractAuthorizeConsent(query: unknown): {
  approved: boolean;
  oauthQuery: unknown;
} {
  if (!isRecord(query)) {
    return {
      approved: false,
      oauthQuery: query,
    };
  }

  const { [authorizeConsentParam]: consent, ...oauthQuery } = query;

  return {
    approved: consent === authorizeConsentValue,
    oauthQuery,
  };
}

function withDefaultResource(input: unknown, resource: string): unknown {
  if (!isRecord(input) || input.resource !== undefined) {
    return input;
  }

  return {
    ...input,
    resource,
  };
}

function buildWebAuthorizeUrl(
  webAppUrl: string,
  query: McpOAuthAuthorizeQuery,
): string {
  const url = new URL(webMcpAuthorizePath, trimTrailingSlash(webAppUrl));
  const searchParams = new URLSearchParams({
    response_type: query.response_type,
    client_id: query.client_id,
    redirect_uri: query.redirect_uri,
    code_challenge: query.code_challenge,
    code_challenge_method: query.code_challenge_method,
    scope: query.scope,
    resource: query.resource,
  });

  if (query.state) {
    searchParams.set("state", query.state);
  }

  url.search = searchParams.toString();

  return url.toString();
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeOAuthError(response: RawResponse, error: unknown): void {
  if (error instanceof OAuthProtocolError) {
    response.status(error.status).json(error.toResponseBody());
    return;
  }

  throw error;
}

function writeValidationError(
  response: RawResponse,
  error: z.ZodError,
): void {
  response.status(HttpStatus.BAD_REQUEST).json({
    error: "invalid_request",
    error_description: error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  });
}

function writeDynamicClientRegistrationValidationError(
  response: RawResponse,
  error: z.ZodError,
): void {
  response.status(HttpStatus.BAD_REQUEST).json({
    error: "invalid_client_metadata",
    error_description: error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  });
}
