import { describe, expect, it } from "vitest";

import type { RequestWithContext } from "../../http/request-context";
import { SystemUpdateOperatorService } from "./system-update-operator.service";

describe("SystemUpdateOperatorService", () => {
  it("uses SYSTEM_OPERATOR_USER_IDS before username fallback", () => {
    const service = createService({
      SYSTEM_OPERATOR_USER_IDS: "user-1",
      SYSTEM_OPERATOR_USERNAMES: "admin",
    });

    expect(service.canOperate(createRequest("user-1", "someone"))).toBe(true);
    expect(service.canOperate(createRequest("user-2", "admin"))).toBe(false);
  });

  it("uses SYSTEM_OPERATOR_USERNAMES only when user ids are not configured", () => {
    const service = createService({
      SYSTEM_OPERATOR_USERNAMES: "admin, ops",
    });

    expect(service.canOperate(createRequest("user-2", "ops"))).toBe(true);
    expect(service.canOperate(createRequest("user-2", "guest"))).toBe(false);
  });

  it("reports whether an allowlist is configured", () => {
    expect(createService({}).hasConfiguredAllowlist()).toBe(false);
    expect(
      createService({ SYSTEM_OPERATOR_USER_IDS: "user-1" }).hasConfiguredAllowlist(),
    ).toBe(true);
  });
});

function createService(values: Record<string, string | undefined>) {
  return new SystemUpdateOperatorService({
    get: (key: string) => values[key],
  } as never);
}

function createRequest(userId: string, username: string): RequestWithContext {
  return {
    currentUser: {
      id: userId,
      username,
      name: username,
      status: "ACTIVE",
      preferences: {
        locale: "zh-CN",
        themeMode: "LIGHT",
      },
    },
    session: {
      expiresAt: new Date("2026-05-22T00:00:00.000Z"),
      sessionId: "session-1",
      tokenHash: "token-hash",
      userId,
    },
  };
}
