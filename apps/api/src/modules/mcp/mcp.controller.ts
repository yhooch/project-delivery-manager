import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { McpProtocolVersionHeaderName } from "@project-delivery/shared";

import { SkipApiResponse } from "../../http/api-response.interceptor";
import {
  firstHeaderValue,
  type HeaderValue,
  type McpOAuthPrincipalContext,
  type RequestWithContext,
} from "../../http/request-context";
import { getRequestMetadata } from "../auth/request-metadata";
import { McpBearerAuthenticationError } from "../oauth/mcp-bearer-auth.error";
import { OAuthService } from "../oauth/oauth.service";
import { McpService, type McpHttpErrorBody } from "./mcp.service";

type RawMcpResponse = {
  end(): void;
  setHeader(name: string, value: string): void;
  status(statusCode: number): RawMcpResponse;
  json(body: unknown): void;
};

@Controller("mcp")
@SkipApiResponse()
export class McpController {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
    @Inject(McpService)
    private readonly mcp: McpService,
  ) {}

  @Get()
  getStreamEntry(
    @Req() request: RequestWithContext,
    @Res() response: RawMcpResponse,
  ): void {
    if (!accepts(request, "text/event-stream")) {
      writeJson(response, HttpStatus.NOT_ACCEPTABLE, {
        code: "BAD_REQUEST",
        message: "GET /mcp requires Accept: text/event-stream.",
      });
      return;
    }

    response.setHeader("Allow", "POST");
    writeJson(response, HttpStatus.METHOD_NOT_ALLOWED, {
      code: "BAD_REQUEST",
      message: "MCP server-to-client stream is not enabled in this phase.",
    });
  }

  @Post()
  async postJsonRpc(
    @Body() body: unknown,
    @Req() request: RequestWithContext,
    @Res() response: RawMcpResponse,
  ): Promise<void> {
    if (
      !accepts(request, "application/json") ||
      !accepts(request, "text/event-stream")
    ) {
      writeJson(response, HttpStatus.NOT_ACCEPTABLE, {
        code: "BAD_REQUEST",
        message:
          "POST /mcp requires Accept including application/json and text/event-stream.",
      });
      return;
    }

    const principal = await this.authenticate(request, response);

    if (!principal) {
      return;
    }

    const result = await this.mcp.handle(
      body,
      principal,
      getHeader(request.headers, McpProtocolVersionHeaderName),
      getRequestMetadata(request),
    );

    if (result.kind === "empty") {
      response.status(result.status).end();
      return;
    }

    if (result.kind === "auth-error") {
      response.setHeader(
        "WWW-Authenticate",
        this.oauth.buildBearerChallenge(result.challenge),
      );
      writeJson(response, result.status, result.body);
      return;
    }

    writeJson(response, result.status, result.body);
  }

  private async authenticate(
    request: RequestWithContext,
    response: RawMcpResponse,
  ): Promise<McpOAuthPrincipalContext | undefined> {
    try {
      return await this.oauth.validateBearerToken(
        getHeader(request.headers, "authorization"),
      );
    } catch (error) {
      if (error instanceof McpBearerAuthenticationError) {
        response.setHeader(
          "WWW-Authenticate",
          this.oauth.buildBearerChallenge({
            error: error.challengeError,
            errorDescription: error.message,
            scope: error.requiredScope,
          }),
        );
        writeJson(response, error.status, {
          code:
            error.status === HttpStatus.FORBIDDEN
              ? "MCP_INSUFFICIENT_SCOPE"
              : "MCP_UNAUTHORIZED",
          message: error.message,
        });
        return undefined;
      }

      throw error;
    }
  }
}

function writeJson(
  response: RawMcpResponse,
  status: number,
  body: McpHttpErrorBody | unknown,
): void {
  response.status(status).json(body);
}

function accepts(request: RequestWithContext, mediaType: string): boolean {
  const accept = getHeader(request.headers, "accept");

  if (!accept) {
    return false;
  }

  return accept
    .split(",")
    .map((part) => part.trim())
    .some((part) => mediaRangeMatches(part, mediaType));
}

function mediaRangeMatches(rangeWithParams: string, mediaType: string): boolean {
  const [range = "", ...params] = rangeWithParams
    .split(";")
    .map((part) => part.trim().toLowerCase());

  if (!range || params.some((param) => param === "q=0" || param === "q=0.0")) {
    return false;
  }

  const [rangeType, rangeSubtype] = range.split("/");
  const [mediaTypeName, mediaSubtype] = mediaType.toLowerCase().split("/");

  if (!rangeType || !rangeSubtype || !mediaTypeName || !mediaSubtype) {
    return false;
  }

  return (
    (rangeType === "*" || rangeType === mediaTypeName) &&
    (rangeSubtype === "*" || rangeSubtype === mediaSubtype)
  );
}

function getHeader(
  headers: Record<string, HeaderValue> | undefined,
  name: string,
): string | undefined {
  const expected = name.toLowerCase();

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === expected) {
      return firstHeaderValue(value);
    }
  }

  return undefined;
}
