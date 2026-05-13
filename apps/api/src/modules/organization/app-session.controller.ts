import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import {
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
    @Query("recentOrganizationId")
    recentOrganizationId: string | string[] | undefined,
    @Query("recentSpaceId")
    recentSpaceId: string | string[] | undefined,
  ): Promise<GetAuthSessionResponse> {
    const user = this.currentUser.requireUser(request);

    return this.appSessions.buildForUser(
      user,
      parseRecentUlid(recentOrganizationId),
      parseRecentUlid(recentSpaceId),
    );
  }
}

function parseRecentUlid(
  value: string | string[] | undefined,
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const result = UlidSchema.safeParse(candidate);

  return result.success ? result.data : undefined;
}
