import type { ApiError } from "@project-delivery/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient, ApiClientError, createApiUrl } from "./api-client";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds /api/v1 URLs with repeated query values", () => {
    expect(
      createApiUrl("/work-items", {
        page: 2,
        pageSize: 20,
        state: ["open", "blocked"],
        unset: undefined,
      }),
    ).toBe("/api/v1/work-items?page=2&pageSize=20&state=open&state=blocked");
  });

  it("returns typed ApiResponse payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: {
            ok: true,
          },
          requestId: "req_123",
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await apiClient.get<{ ok: boolean }>("/health");

    expect(result).toEqual({
      data: {
        ok: true,
      },
      requestId: "req_123",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/health",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("serializes JSON request bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: {},
          requestId: "req_456",
        }),
        { status: 200 },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await apiClient.post("/auth/login", {
      password: "secret",
      username: "demo",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(init).toBeDefined();
    expect(init).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          password: "secret",
          username: "demo",
        }),
        method: "POST",
      }),
    );
    expect((init?.headers as Headers | undefined)?.get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("throws ApiClientError with shared ApiError payloads", async () => {
    const error: ApiError = {
      code: "UNAUTHORIZED",
      message: "Unauthorized",
      requestId: "req_error",
    };
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify(error), {
        status: 401,
        statusText: "Unauthorized",
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.get("/auth/session")).rejects.toBeInstanceOf(
      ApiClientError,
    );

    try {
      await apiClient.get("/auth/session");
    } catch (caught) {
      expect(caught).toMatchObject({
        error,
        status: 401,
      });
    }
  });
});
