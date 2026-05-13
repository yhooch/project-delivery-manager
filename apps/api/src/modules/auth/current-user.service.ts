import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../http/api-exception";
import type { RequestWithContext } from "../../http/request-context";
import type {
  AuthenticatedSessionContext,
  AuthenticatedUserContext,
} from "./auth-session.types";

@Injectable()
export class CurrentUserService {
  requireSession(request: RequestWithContext): AuthenticatedSessionContext {
    if (!request.session) {
      throw new ApiException(
        "UNAUTHORIZED",
        "Authentication is required",
        HttpStatus.UNAUTHORIZED,
      );
    }

    return request.session;
  }

  requireUser(request: RequestWithContext): AuthenticatedUserContext {
    if (!request.currentUser) {
      throw new ApiException(
        "UNAUTHORIZED",
        "Authentication is required",
        HttpStatus.UNAUTHORIZED,
      );
    }

    return request.currentUser;
  }
}
