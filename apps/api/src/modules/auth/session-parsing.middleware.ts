import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import type { RequestWithContext } from "../../http/request-context";
import { AuthSessionService } from "./auth-session.service";

type Response = unknown;

@Injectable()
export class SessionParsingMiddleware implements NestMiddleware {
  constructor(
    @Inject(AuthSessionService)
    private readonly sessions: AuthSessionService,
  ) {}

  async use(
    request: RequestWithContext,
    _response: Response,
    next: () => void,
  ): Promise<void> {
    const token = request.cookies?.[this.sessions.getCookieName()];
    const context = await this.sessions.resolveToken(token);

    if (context) {
      request.session = context.session;
      request.currentUser = context.user;
    }

    next();
  }
}
