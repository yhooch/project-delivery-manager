import { HttpException, type HttpStatus } from "@nestjs/common";
import type { ApiErrorCode } from "@project-delivery/shared";

export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
