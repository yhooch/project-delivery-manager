import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { McpScope } from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import {
  firstHeaderValue,
  type RequestWithContext,
} from "../../http/request-context";
import { McpBearerAuthenticationError } from "./mcp-bearer-auth.error";
import { MCP_REQUIRED_SCOPES_METADATA } from "./mcp-scopes.decorator";
import { OAuthService } from "./oauth.service";

type ResponseWithHeaders = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class McpBearerAuthGuard implements CanActivate {
  constructor(
    @Inject(OAuthService)
    private readonly oauth: OAuthService,
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const response = context.switchToHttp().getResponse<ResponseWithHeaders>();

    try {
      request.mcpPrincipal = await this.oauth.validateBearerToken(
        firstHeaderValue(request.headers?.authorization),
        this.getRequiredScopes(context),
      );
      return true;
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

        throw new ApiException(
          error.status === HttpStatus.FORBIDDEN
            ? "MCP_INSUFFICIENT_SCOPE"
            : "MCP_UNAUTHORIZED",
          error.message,
          error.status,
        );
      }

      throw error;
    }
  }

  private getRequiredScopes(context: ExecutionContext): McpScope[] {
    return (
      this.reflector.getAllAndOverride<McpScope[]>(
        MCP_REQUIRED_SCOPES_METADATA,
        [context.getHandler(), context.getClass()],
      ) ?? []
    );
  }
}
