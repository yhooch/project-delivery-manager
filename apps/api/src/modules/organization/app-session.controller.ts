import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  RecentOrganizationCookieName,
  RecentSpaceCookieName,
  UlidSchema,
  type GetAuthSessionResponse,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { AppSessionService } from "./app-session.service";

@Controller("auth")
export class AppSessionController {
  constructor(
    @Inject(AppSessionService)
    private readonly appSessions: AppSessionService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("session")
  @UseGuards(RequireSessionGuard)
  async getSession(
    @Req() request: RequestWithContext,
  ): Promise<GetAuthSessionResponse> {
    const user = this.currentUser.requireUser(request);
    const recentOrganizationCookie =
      request.cookies?.[RecentOrganizationCookieName];
    const recentSpaceCookie = request.cookies?.[RecentSpaceCookieName];

    return this.appSessions.buildForUser(
      user,
      parseRecentUlid(recentOrganizationCookie),
      parseRecentUlid(recentSpaceCookie),
    );
  }
}

function parseRecentUlid(value: unknown): string | undefined {
  const result = UlidSchema.safeParse(value);

  return result.success ? result.data : undefined;
}
