import { Controller, Get, Req, UseGuards } from "@nestjs/common";

import type { RequestWithContext } from "./http/request-context";
import { RequireSessionGuard } from "./modules/auth/session.guard";

@Controller("demo")
export class DemoController {
  @Get("protected")
  @UseGuards(RequireSessionGuard)
  getProtected(@Req() request: RequestWithContext) {
    return {
      sessionId: request.session?.sessionId,
      userId: request.session?.userId,
      preferences: request.currentUser?.preferences,
    };
  }
}
