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
import {
  McpOAuthAuthorizeQuerySchema,
  McpOAuthDynamicClientRegistrationRequestSchema,
  McpOAuthRevocationRequestSchema,
  McpOAuthTokenRequestSchema,
  RevokeAuthorizedMcpClientRequestSchema,
  type ListAuthorizedMcpClientsResponse,
  type McpOAuthApproveAuthorizationResponse,
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

const webMcpAuthorizePath = "/zh-CN/oauth/mcp/authorize";

@Controller()
export class OAuthDiscoveryController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
  ) {}

  @Get(".well-known/oauth-protected-resource")
  getProtectedResourceMetadata(
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): void {
    response
      .status(HttpStatus.OK)
      .json(this.oauth.getProtectedResourceMetadata(request));
  }

  @Get(".well-known/oauth-authorization-server")
  getAuthorizationServerMetadata(
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): void {
    response
      .status(HttpStatus.OK)
      .json(this.oauth.getAuthorizationServerMetadata(request));
  }
}

@Controller("oauth")
export class OAuthController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
    @Inject(OAuthConfigService)
    private readonly oauthConfig: OAuthConfigService,
  ) {}

  @Get("authorize")
  async authorize(
    @Query() query: unknown,
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthAuthorizeQuerySchema.safeParse(
      withDefaultResource(
        query,
        this.oauthConfig.getCanonicalResource(request),
      ),
    );

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
      return;
    }

    if (!wantsJson(request)) {
      response.redirect(
        HttpStatus.FOUND,
        buildWebAuthorizeUrl(this.oauthConfig.getIssuer(request), parsed.data),
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
        request,
      );

      response.status(HttpStatus.OK).json(prepared.context);
    } catch (error) {
      writeOAuthError(response, error);
    }
  }

  @Post("authorize/approve")
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteOriginGuard)
  async approveAuthorization(
    @Query() query: unknown,
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthAuthorizeQuerySchema.safeParse(
      withDefaultResource(
        query,
        this.oauthConfig.getCanonicalResource(request),
      ),
    );

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
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
        request,
      );
      const result = await prepared.grant();
      const body: McpOAuthApproveAuthorizationResponse = {
        redirectTo: result.redirectTo,
      };

      response.status(HttpStatus.OK).json(body);
    } catch (error) {
      writeOAuthError(response, error);
    }
  }

  @Post("token")
  @HttpCode(HttpStatus.OK)
  async token(
    @Body() body: unknown,
    @Req() request: RequestWithContext,
    @Res() response: RawResponse,
  ): Promise<void> {
    const parsed = McpOAuthTokenRequestSchema.safeParse(
      withDefaultResource(body, this.oauthConfig.getCanonicalResource(request)),
    );

    if (!parsed.success) {
      writeValidationError(response, parsed.error);
      return;
    }

    try {
      const tokenResponse = await this.oauth.exchangeToken(
        parsed.data,
        request,
      );
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
    const parsed =
      McpOAuthDynamicClientRegistrationRequestSchema.safeParse(body);

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
  return (
    firstHeaderValue(request.headers?.accept)?.includes("application/json") ??
    false
  );
}

function withDefaultResource(input: unknown, resource: string): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const normalizedResource = normalizeResource(input.resource, resource);

  if (normalizedResource === input.resource) {
    return input;
  }

  return {
    ...input,
    resource: normalizedResource,
  };
}

function normalizeResource(value: unknown, defaultResource: string): unknown {
  if (value === undefined) {
    return defaultResource;
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const [first, ...rest] = value;

  if (typeof first === "string" && rest.every((item) => item === first)) {
    return first;
  }

  return value;
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

function writeValidationError(response: RawResponse, error: z.ZodError): void {
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
