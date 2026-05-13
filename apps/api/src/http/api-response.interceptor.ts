import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { ApiResponse } from "@project-delivery/shared";
import { map, type Observable } from "rxjs";

import { getRequestId, type RequestWithContext } from "./request-context";

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    return next.handle().pipe(
      map((data) => {
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
