import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  UpdateUserPreferencesRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type LogoutResponse,
  type RegisterRequest,
  type UpdateUserPreferencesRequest,
  type UpdateUserPreferencesResponse,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { CurrentUserService } from "./current-user.service";
import { getRequestMetadata } from "./request-metadata";
import { RequireSessionGuard } from "./session.guard";
import {
  clearSessionCookie,
  type CookieResponse,
  setSessionCookie,
} from "./session-cookie";
import { WriteOriginGuard } from "./write-origin.guard";

@Controller("auth")
@UseGuards(WriteOriginGuard)
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Post("register")
  @HttpCode(HttpStatus.OK)
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema))
    body: RegisterRequest,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.register(body, getRequestMetadata(request));
    setSessionCookie(response, this.config, result.cookie);
    return result.appSession;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema))
    body: LoginRequest,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.login(body, getRequestMetadata(request));
    setSessionCookie(response, this.config, result.cookie);
    return result.appSession;
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RequireSessionGuard)
  async logout(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LogoutResponse> {
    const session = this.currentUser.requireSession(request);
    await this.auth.logout(
      session.sessionId,
      session.userId,
      getRequestMetadata(request),
    );
    clearSessionCookie(response, this.config, this.authCookieName());
    return {};
  }

  private authCookieName(): string {
    return this.config.get<string>("SESSION_COOKIE_NAME") ?? "pdm_session";
  }
}

@Controller("users/me")
@UseGuards(WriteOriginGuard, RequireSessionGuard)
export class CurrentUserController {
  constructor(
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Patch("password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema))
    body: ChangePasswordRequest,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LogoutResponse> {
    const session = this.currentUser.requireSession(request);
    await this.auth.changePassword(session.userId, body);
    clearSessionCookie(response, this.config, this.authCookieName());
    return {};
  }

  @Patch("preferences")
  @HttpCode(HttpStatus.OK)
  async updatePreferences(
    @Body(new ZodValidationPipe(UpdateUserPreferencesRequestSchema))
    body: UpdateUserPreferencesRequest,
    @Req() request: RequestWithContext,
  ): Promise<UpdateUserPreferencesResponse> {
    const session = this.currentUser.requireSession(request);
    return this.auth.updatePreferences(session.userId, body);
  }

  private authCookieName(): string {
    return this.config.get<string>("SESSION_COOKIE_NAME") ?? "pdm_session";
  }
}
