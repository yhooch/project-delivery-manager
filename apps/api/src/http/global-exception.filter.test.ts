import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "./global-exception.filter";

describe("GlobalExceptionFilter", () => {
  it("uses INTERNAL_SERVER_ERROR for unknown exceptions", () => {
    const { host, json, setHeader, status } = createHttpHost("req_unknown");

    new GlobalExceptionFilter().catch(new Error("boom"), host);

    expect(setHeader).toHaveBeenCalledWith("x-request-id", "req_unknown");
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      requestId: "req_unknown",
    });
  });

  it("maps uncoded HTTP 500 exceptions to INTERNAL_SERVER_ERROR", () => {
    const { host, json, status } = createHttpHost("req_http_500");

    new GlobalExceptionFilter().catch(
      new HttpException(
        "Database unavailable",
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
      requestId: "req_http_500",
    });
  });
});

function createHttpHost(requestId: string) {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId }),
      getResponse: () => ({
        setHeader,
        status,
      }),
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    json,
    setHeader,
    status,
  };
}
