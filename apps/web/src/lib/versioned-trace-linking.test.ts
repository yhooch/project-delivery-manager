import { describe, expect, it } from "vitest";

import { ApiClientError } from "./api-client";
import {
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

    expect(filterTraceOptionsByVersion(options, otherVersionId, "versioned"))
      .toEqual([
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

  it("detects trace cascade errors and builds a confirmation message", () => {
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
        body: "版本变更会影响已关联的下游对象，请确认后继续。",
        suffix: "确认后将同步更新已关联对象的版本，是否继续？",
      }),
    ).toBe(
      "版本变更会影响已关联的下游对象，请确认后继续。\n\n确认后将同步更新已关联对象的版本，是否继续？",
    );
    expect(traceVersionCascadeConfirmMessage()).not.toContain(
      "Version change affects linked delivery items",
    );
  });
});
