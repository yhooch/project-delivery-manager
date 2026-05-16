import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-client";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
  isTraceVersionCascadeRequiredError,
  traceVersionCascadeConfirmMessage,
} from "./versioned-trace-linking";

const versionId = "01ARZ3NDEKTSV4RRFFQ69G5FV1";
const otherVersionId = "01ARZ3NDEKTSV4RRFFQ69G5FV2";

describe("versioned trace linking", () => {
  it("keeps unversioned options available under any selected version", () => {
    const options = [
      { id: "versioned", versionId },
      { id: "other", versionId: otherVersionId },
      { id: "unversioned" },
    ];

    expect(filterTraceOptionsByVersion(options, versionId)).toEqual([
      { id: "versioned", versionId },
      { id: "unversioned" },
    ]);
  });

  it("treats versioned upstreams as requiring the same selected version", () => {
    expect(
      isTraceOptionCompatibleWithVersion({ versionId }, versionId),
    ).toBe(true);
    expect(isTraceOptionCompatibleWithVersion({ versionId }, "")).toBe(false);
    expect(
      isTraceOptionCompatibleWithVersion({ versionId }, otherVersionId),
    ).toBe(false);
    expect(isTraceOptionCompatibleWithVersion({}, otherVersionId)).toBe(true);
  });

  it("detects trace cascade errors and builds a confirmation message", () => {
    const error = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        message: "需要同步下游对象",
        requestId: "REQ_TRACE",
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );

    expect(isTraceVersionCascadeRequiredError(error)).toBe(true);
    expect(traceVersionCascadeConfirmMessage(error)).toContain("需要同步下游对象");
  });
});
