import { describe, expect, it } from "vitest";

import { ApiException } from "../../http/api-exception";
import { assertTraceRefsMatchVersion } from "./trace-version-policy";

describe("trace version policy", () => {
  it("raises TRACE_CASCADE_CONFLICT when cascade refs target another upstream version", () => {
    try {
      assertTraceRefsMatchVersion({
        details: {
          targetId: "01H00000000000000000000001",
          targetType: "REQUIREMENT",
        },
        refs: [
          {
            label: "intake item",
            versionId: "01H00000000000000000000002",
          },
        ],
        versionId: "01H00000000000000000000003",
      });
      throw new Error("Expected TRACE_CASCADE_CONFLICT");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({
        code: "TRACE_CASCADE_CONFLICT",
      });
      expect((error as ApiException).getStatus()).toBe(409);
    }
  });
});
