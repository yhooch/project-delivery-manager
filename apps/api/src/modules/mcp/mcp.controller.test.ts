import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { McpOAuthPrincipalContext } from "../../http/request-context";
import { McpBearerAuthenticationError } from "../oauth/mcp-bearer-auth.error";
import type { OAuthService } from "../oauth/oauth.service";
import { McpController } from "./mcp.controller";
import type { McpService } from "./mcp.service";

describe("McpController", () => {
  it("rejects POST requests unless Accept contains JSON and SSE", async () => {
    const { controller, mcp, oauth } = createSubject();
    const response = new MockMcpResponse();

    await controller.postJsonRpc(
      {},
      {
        headers: {
          accept: "application/json",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(HttpStatus.NOT_ACCEPTABLE);
    expect(oauth.validateBearerToken).not.toHaveBeenCalled();
    expect(mcp.handle).not.toHaveBeenCalled();
  });

  it("returns Bearer challenge responses without using the REST wrapper", async () => {
    const { controller, oauth } = createSubject();
    const response = new MockMcpResponse();
    oauth.validateBearerToken.mockRejectedValueOnce(
      new McpBearerAuthenticationError(
        HttpStatus.UNAUTHORIZED,
        "invalid_token",
        "Bearer token is required",
      ),
    );

    await controller.postJsonRpc(
      {},
      {
        headers: {
          accept: "application/json, text/event-stream",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    expect(response.headers.get("www-authenticate")).toBe("Bearer challenge");
    expect(response.body).toEqual({
      code: "MCP_UNAUTHORIZED",
      message: "Bearer token is required",
    });
  });

  it("passes authenticated JSON-RPC messages with the protocol version header", async () => {
    const { controller, mcp } = createSubject();
    const response = new MockMcpResponse();
    const body = {
      jsonrpc: "2.0",
      id: "list-1",
      method: "tools/list",
    };

    await controller.postJsonRpc(
      body,
      {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer token",
          "mcp-protocol-version": "2025-11-25",
          "user-agent": "mcp-test",
        },
        ip: "127.0.0.1",
        requestId: "req-1",
      },
      response,
    );

    expect(mcp.handle).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        userId: "01HX0000000000000000000000",
      }),
      "2025-11-25",
      {
        ip: "127.0.0.1",
        requestId: "req-1",
        userAgent: "mcp-test",
      },
    );
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: "list-1",
      result: {
        tools: [],
      },
    });
    expect(response.headers.has("mcp-session-id")).toBe(false);
  });

  it("recognizes GET stream entry requests but keeps SSE disabled", () => {
    const { controller } = createSubject();
    const response = new MockMcpResponse();

    controller.getStreamEntry(
      {
        headers: {
          accept: "text/event-stream",
        },
      },
      response,
    );

    expect(response.statusCode).toBe(HttpStatus.METHOD_NOT_ALLOWED);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

function createSubject() {
  const principal: McpOAuthPrincipalContext = {
    accessTokenId: "access-token-id",
    authorizationId: "authorization-id",
    clientId: "test-client",
    resource: "http://localhost:3001/api/v1/mcp",
    scopes: ["mcp:read"],
    userId: "01HX0000000000000000000000",
  };
  const oauth = {
    buildBearerChallenge: vi.fn(() => "Bearer challenge"),
    validateBearerToken: vi.fn(async () => principal),
  };
  const mcp = {
    handle: vi.fn(async () => ({
      body: {
        jsonrpc: "2.0",
        id: "list-1",
        result: {
          tools: [],
        },
      },
      kind: "json-rpc",
      status: HttpStatus.OK,
    })),
  };

  return {
    controller: new McpController(
      oauth as unknown as OAuthService,
      mcp as unknown as McpService,
    ),
    mcp,
    oauth,
  };
}

class MockMcpResponse {
  body: unknown;
  ended = false;
  readonly headers = new Map<string, string>();
  statusCode = 0;

  end(): void {
    this.ended = true;
  }

  json(body: unknown): void {
    this.body = body;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }
}
