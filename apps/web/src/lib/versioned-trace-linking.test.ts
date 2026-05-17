import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-client";
import {
  clearIncompatibleTraceSelection,
  filterTraceOptionsByVersion,
  getTraceVersionErrorCode,
  inheritVersionFromTraceOption,
  isTraceOptionCompatibleWithVersion,
  isTraceVersionError,
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

  it("keeps the current selected option available even when versions differ", () => {
    const options = [
      { id: "versioned", versionId },
      { id: "other", versionId: otherVersionId },
      { id: "unversioned" },
    ];

    expect(
      filterTraceOptionsByVersion(options, otherVersionId, "versioned"),
    ).toEqual([
      { id: "versioned", versionId },
      { id: "other", versionId: otherVersionId },
      { id: "unversioned" },
    ]);
  });

  it("treats versioned upstreams as requiring the same selected version", () => {
    expect(isTraceOptionCompatibleWithVersion({ versionId }, versionId)).toBe(
      true,
    );
    expect(isTraceOptionCompatibleWithVersion({ versionId }, "")).toBe(false);
    expect(
      isTraceOptionCompatibleWithVersion({ versionId }, otherVersionId),
    ).toBe(false);
    expect(isTraceOptionCompatibleWithVersion({}, otherVersionId)).toBe(true);
  });

  it("inherits a version from a selected upstream without requiring one", () => {
    expect(inheritVersionFromTraceOption({ id: "a", versionId }, "")).toBe(
      versionId,
    );
    expect(inheritVersionFromTraceOption({ id: "a" }, otherVersionId)).toBe(
      otherVersionId,
    );
    expect(inheritVersionFromTraceOption(undefined, otherVersionId)).toBe(
      otherVersionId,
    );
  });

  it("clears selected upstreams that are incompatible with the next version", () => {
    const options = [{ id: "versioned", versionId }, { id: "unversioned" }];

    expect(
      clearIncompatibleTraceSelection(options, "versioned", otherVersionId),
    ).toBe("");
    expect(
      clearIncompatibleTraceSelection(options, "versioned", versionId),
    ).toBe("versioned");
    expect(
      clearIncompatibleTraceSelection(options, "unversioned", otherVersionId),
    ).toBe("unversioned");
  });

  it("detects all trace version error codes", () => {
    for (const code of [
      "TRACE_VERSION_CONFLICT",
      "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
      "TRACE_CASCADE_CONFLICT",
    ] as const) {
      const error = new ApiClientError(
        {
          code,
          message: "trace conflict",
          requestId: "REQ_TRACE",
        },
        new Response(null, { status: 409, statusText: "Conflict" }),
      );

      expect(isTraceVersionError(error)).toBe(true);
      expect(getTraceVersionErrorCode(error)).toBe(code);
    }
  });

  it("detects trace cascade errors and builds a caller-provided confirmation message", () => {
    const error = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        message:
          "Version change affects linked delivery items; set cascadeVersionChange to true.",
        requestId: "REQ_TRACE",
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );

    expect(isTraceVersionCascadeRequiredError(error)).toBe(true);
    expect(
      traceVersionCascadeConfirmMessage({
        body: "Changing the version affects linked delivery items.",
        suffix: "Continue and update linked item versions?",
      }),
    ).toBe(
      "Changing the version affects linked delivery items.\n\nContinue and update linked item versions?",
    );
  });

  it("includes structured cascade impact in the confirmation message", () => {
    const error = new ApiClientError(
      {
        code: "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        message: "cascade required",
        requestId: "REQ_TRACE",
        details: {
          targetType: "TASK",
          targetId: "TASK_1",
          fromVersionId: versionId,
          toVersionId: otherVersionId,
          impact: {
            workItemCount: 1,
            workItemIds: ["TASK_2"],
            bugCount: 2,
            bugIds: ["BUG_1", "BUG_2"],
          },
        },
      },
      new Response(null, { status: 409, statusText: "Conflict" }),
    );

    expect(
      traceVersionCascadeConfirmMessage(
        {
          body: "Body",
          suffix: "Suffix",
        },
        error,
      ),
    ).toContain("Affected scope\n- Target: TASK TASK_1");
    expect(
      traceVersionCascadeConfirmMessage(
        {
          body: "Body",
          suffix: "Suffix",
        },
        error,
      ),
    ).toContain(`- Version change: ${versionId} -> ${otherVersionId}`);
    expect(
      traceVersionCascadeConfirmMessage(
        {
          body: "Body",
          suffix: "Suffix",
        },
        error,
      ),
    ).toContain("- Tasks: 1 (IDs: TASK_2)");
    expect(
      traceVersionCascadeConfirmMessage(
        {
          body: "Body",
          suffix: "Suffix",
        },
        error,
      ),
    ).toContain("- Bugs: 2 (IDs: BUG_1, BUG_2)");
  });
});
