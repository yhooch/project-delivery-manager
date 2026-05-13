import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";

import { ApiException } from "../../http/api-exception";
import type { RequestWithContext } from "../../http/request-context";

@Injectable()
export class RequireSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!request.session || !request.currentUser) {
      throw new ApiException(
        "UNAUTHORIZED",
        "Authentication is required",
        HttpStatus.UNAUTHORIZED,
      );
    }

    return true;
  }
}
