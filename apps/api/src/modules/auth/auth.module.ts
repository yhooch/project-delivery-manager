import { Module } from "@nestjs/common";

import { IdentityModule } from "../identity/identity.module";
import { AuthController, CurrentUserController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthSessionBuilder } from "./auth-session.builder";
import { AuthSessionService } from "./auth-session.service";
import { CurrentUserService } from "./current-user.service";
import { RateLimiterService } from "./rate-limiter.service";
import { RequireSessionGuard } from "./session.guard";
import { SessionParsingMiddleware } from "./session-parsing.middleware";
import { SessionTokenService } from "./session-token.service";
import { WriteOriginGuard } from "./write-origin.guard";

@Module({
  controllers: [AuthController, CurrentUserController],
  exports: [
    AuthSessionService,
    CurrentUserService,
    RateLimiterService,
    RequireSessionGuard,
    SessionParsingMiddleware,
    WriteOriginGuard,
  ],
  imports: [IdentityModule],
  providers: [
    AuthService,
    AuthSessionBuilder,
    AuthSessionService,
    CurrentUserService,
    RateLimiterService,
    RequireSessionGuard,
    SessionParsingMiddleware,
    SessionTokenService,
    WriteOriginGuard,
  ],
})
export class AuthModule {}
