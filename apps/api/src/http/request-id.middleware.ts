import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ulid } from "ulid";

import {
  firstHeaderValue,
  type RequestWithContext,
} from "./request-context";

const REQUEST_ID_HEADER = "x-request-id";

type ResponseWithHeaders = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: RequestWithContext,
    response: ResponseWithHeaders,
    next: () => void,
  ): void {
    const incomingRequestId = firstHeaderValue(
      request.headers?.[REQUEST_ID_HEADER],
    )?.trim();
    const requestId = incomingRequestId && incomingRequestId.length > 0
      ? incomingRequestId
      : ulid();

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
