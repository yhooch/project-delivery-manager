import { describe, expect, it } from "vitest";

import {
  getRequestLogContext,
  runWithRequestLogContext,
  updateRequestLogContext,
} from "./request-log-context";

describe("request log context", () => {
  it("updates the current async request context", () => {
    runWithRequestLogContext({ requestId: "req_context" }, () => {
      updateRequestLogContext({
        organizationId: "org_1",
        userId: "user_1",
      });

      expect(getRequestLogContext()).toEqual({
        organizationId: "org_1",
        requestId: "req_context",
        userId: "user_1",
      });
    });
  });
});
