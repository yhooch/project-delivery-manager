import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { Prisma } from "../generated/prisma/client";
import { GlobalExceptionFilter } from "./global-exception.filter";

describe("GlobalExceptionFilter", () => {
  it("maps Prisma unique constraint errors to CONFLICT", () => {
    const { host, json, setHeader, status } = createHttpHost("req_p2002");

    new GlobalExceptionFilter().catch(
      new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`organizationId`,`code`)",
        {
        code: "P2002",
        clientVersion: "6.8.2",
        meta: { target: ["organizationId", "code"] },
        },
      ),
      host,
    );

    expect(setHeader).toHaveBeenCalledWith("x-request-id", "req_p2002");
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      code: "CONFLICT",
      message: "Unique constraint conflict",
      requestId: "req_p2002",
    });
  });

  it("does not expose P2002-shaped non-Prisma errors", () => {
    const { host, json, status } = createHttpHost("req_fake_p2002");

    new GlobalExceptionFilter().catch(
      {
        code: "P2002",
        clientVersion: "6.8.2",
        meta: { target: ["organizationId", "code"] },
        message:
          "Unique constraint failed on the fields: (`organizationId`,`code`)",
      },
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      requestId: "req_fake_p2002",
    });
  });

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

  it("does not expose non-P2002 Prisma-shaped errors", () => {
    const { host, json, status } = createHttpHost("req_prisma_unknown");

    new GlobalExceptionFilter().catch(
      {
        code: "P2025",
        clientVersion: "6.8.2",
        meta: { cause: "Record to update not found." },
        message: "No User found",
      },
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      requestId: "req_prisma_unknown",
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
