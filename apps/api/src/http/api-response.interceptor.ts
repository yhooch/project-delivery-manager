import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiResponse } from "@project-delivery/shared";
import { map, type Observable } from "rxjs";

import { getRequestId, type RequestWithContext } from "./request-context";
import { isRealtimeSseResponse } from "../modules/realtime/realtime-sse.stream";

type ResponseWithHeaders = {
  getHeader?: (name: string) => number | string | string[] | undefined;
};

export const SKIP_API_RESPONSE_METADATA = "api:skip-response";

export function SkipApiResponse() {
  return SetMetadata(SKIP_API_RESPONSE_METADATA, true);
}

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector?: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const response = context.switchToHttp().getResponse<ResponseWithHeaders>();

    return next.handle().pipe(
      map((data) => {
        if (this.shouldSkipApiResponse(context)) {
          return data as ApiResponse<T>;
        }

        if (isRealtimeSseResponse(response)) {
          return data as ApiResponse<T>;
        }

        if (isApiResponse(data)) {
          return data as ApiResponse<T>;
        }

        return {
          data,
          requestId: getRequestId(request),
        };
      }),
    );
  }

  private shouldSkipApiResponse(context: ExecutionContext): boolean {
    return (
      this.reflector?.getAllAndOverride<boolean>(SKIP_API_RESPONSE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "requestId" in value &&
    typeof value.requestId === "string"
  );
}
