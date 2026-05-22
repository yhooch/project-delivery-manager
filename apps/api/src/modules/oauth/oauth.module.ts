import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { OAuthClientMetadataService } from "./oauth-client-metadata.service";
import { OAuthConfigService } from "./oauth-config.service";
import {
  AuthorizedMcpClientsController,
  OAuthController,
  OAuthDiscoveryController,
} from "./oauth.controller";
import { McpBearerAuthGuard } from "./mcp-bearer-auth.guard";
import { OAuthService } from "./oauth.service";
import { OAuthTokenService } from "./oauth-token.service";
import { PrismaMcpOAuthRepository } from "./prisma-oauth.repository";
import { MCP_OAUTH_REPOSITORY } from "./oauth.types";

@Module({
  controllers: [
    AuthorizedMcpClientsController,
    OAuthController,
    OAuthDiscoveryController,
  ],
  exports: [
    MCP_OAUTH_REPOSITORY,
    McpBearerAuthGuard,
    OAuthConfigService,
    OAuthService,
    OAuthTokenService,
  ],
  imports: [AuthModule, PrismaModule],
  providers: [
    OAuthClientMetadataService,
    OAuthConfigService,
    OAuthService,
    OAuthTokenService,
    McpBearerAuthGuard,
    {
      provide: MCP_OAUTH_REPOSITORY,
      useClass: PrismaMcpOAuthRepository,
    },
  ],
})
export class OAuthModule {}
