import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../http/api-exception";
import type { RequestWithContext } from "../../http/request-context";
import { SystemUpdateOperatorService } from "./system-update-operator.service";

@Injectable()
export class SystemUpdateOperatorGuard implements CanActivate {
  constructor(private readonly operators: SystemUpdateOperatorService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!this.operators.hasConfiguredAllowlist()) {
      throw new ApiException(
        "PLATFORM_OPERATOR_REQUIRED",
        "System update operator allowlist is not configured",
        HttpStatus.FORBIDDEN,
      );
    }

    if (!this.operators.canOperate(request)) {
      throw new ApiException(
        "UPDATE_ACCESS_DENIED",
        "System update access denied",
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
