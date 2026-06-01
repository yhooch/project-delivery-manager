import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import {
  ApiErrorCodeSchema,
  type ApiError,
  type ApiErrorCode,
} from "@project-delivery/shared";

import { ApiException } from "./api-exception";
import { getRequestId, type RequestWithContext } from "./request-context";

type HttpResponse = {
  setHeader?(name: string, value: string): void;
  status(statusCode: number): {
    json(body: unknown): void;
  };
};

type ExceptionResponse = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<HttpResponse>();
    const status = getHttpStatus(exception);
    const requestId = getRequestId(request);
    const error = toApiError(exception, status, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(exception, request, requestId, status);
    }

    response.setHeader?.("x-request-id", requestId);
    response.status(status).json(error);
  }

  private logServerError(
    exception: unknown,
    request: RequestWithContext,
    requestId: string,
    status: number,
  ): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    const httpRequest = request as RequestWithContext & {
      method?: unknown;
      originalUrl?: unknown;
      url?: unknown;
    };
    const method =
      typeof httpRequest.method === "string" ? httpRequest.method : "UNKNOWN";
    const path =
      typeof httpRequest.originalUrl === "string"
        ? httpRequest.originalUrl
        : typeof httpRequest.url === "string"
          ? httpRequest.url
          : "UNKNOWN";
    const message = `Unhandled HTTP exception ${status} ${method} ${path} requestId=${requestId}`;

    if (exception instanceof Error) {
      this.logger.error(message, exception.stack);
      return;
    }

    this.logger.error(message, JSON.stringify(exception));
  }
}

function toApiError(
  exception: unknown,
  status: number,
  requestId: string,
): ApiError {
  if (exception instanceof ApiException) {
    return compactApiError({
      code: exception.code,
      message: exception.message,
      details: exception.details,
      requestId,
    });
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const responseObject = isObject(response)
      ? (response as ExceptionResponse)
      : undefined;

    return compactApiError({
      code: getApiErrorCode(responseObject?.code, status),
      message: getExceptionMessage(responseObject?.message, exception.message),
      details: responseObject?.details,
      requestId,
    });
  }

  return {
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    requestId,
  };
}

function compactApiError(error: {
  code: ApiErrorCode;
  details?: unknown;
  message: string;
  requestId: string;
}): ApiError {
  return error.details === undefined
    ? {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
      }
    : error;
}

function getHttpStatus(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function getApiErrorCode(code: unknown, status: number): ApiErrorCode {
  if (ApiErrorCodeSchema.safeParse(code).success) {
    return code as ApiErrorCode;
  }

  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        return "INTERNAL_SERVER_ERROR";
      }

      return "BAD_REQUEST";
  }
}

function getExceptionMessage(message: unknown, fallback: string): string {
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  if (Array.isArray(message) && message.length > 0) {
    return message.join("; ");
  }

  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
