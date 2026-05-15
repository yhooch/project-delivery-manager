import { describe, expect, it } from "vitest";

import { toVersionBoardWorkItemSummary } from "./version.mappers";
import type { VersionBoardWorkItemRecord } from "./version.types";

const now = new Date("2026-05-13T12:00:00.000Z");

describe("version board work item mapper", () => {
  it("does not treat broad WAITING or VERIFYING categories as exceptions", () => {
    const waiting = toVersionBoardWorkItemSummary(
      workItem({
        currentState: {
          category: "WAITING",
          code: "waiting_dependency",
          name: "Waiting dependency",
        },
        statusCategory: "WAITING",
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );
    const verifying = toVersionBoardWorkItemSummary(
      workItem({
        bugDetail: {
          deletedAt: null,
          regressionAt: null,
        },
        currentState: {
          category: "VERIFYING",
          code: "qa_verify",
          name: "QA verify",
        },
        statusCategory: "VERIFYING",
        type: "BUG",
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );

    expect(waiting.currentStatus.exceptionHints.pendingConfirm).toBe(false);
    expect(
      waiting.exceptionSignals.some(
        (signal) => signal.type === "pending_confirm",
      ),
    ).toBe(false);
    expect(verifying.currentStatus.exceptionHints.pendingRegression).toBe(
      false,
    );
    expect(
      verifying.exceptionSignals.some(
        (signal) => signal.type === "pending_regression",
      ),
    ).toBe(false);
  });

  it("uses explicit confirm and regression state evidence", () => {
    const confirm = toVersionBoardWorkItemSummary(
      workItem({
        currentState: {
          category: "WAITING",
          code: "waiting_pm_confirm",
          name: "Waiting PM confirm",
        },
        statusCategory: "WAITING",
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );
    const regression = toVersionBoardWorkItemSummary(
      workItem({
        bugDetail: {
          deletedAt: null,
          regressionAt: null,
        },
        currentState: {
          category: "VERIFYING",
          code: "ready_for_regression",
          name: "Ready for regression",
        },
        statusCategory: "VERIFYING",
        type: "BUG",
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );

    expect(confirm.currentStatus.exceptionHints.pendingConfirm).toBe(true);
    expect(confirm.exceptionSignals.map((signal) => signal.type)).toContain(
      "pending_confirm",
    );
    expect(regression.currentStatus.exceptionHints.pendingRegression).toBe(
      true,
    );
    expect(regression.exceptionSignals.map((signal) => signal.type)).toContain(
      "pending_regression",
    );
  });

  it("uses current blocked state for blocked hints and keeps blocked fields as details only", () => {
    const residualBlockedFields = toVersionBoardWorkItemSummary(
      workItem({
        blockedAt: new Date("2026-05-12T12:00:00.000Z"),
        blockedReason: "Old dependency",
        currentState: {
          category: "IN_PROGRESS",
          code: "in_progress",
          name: "In progress",
        },
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );
    const blockedStateWithoutReason = toVersionBoardWorkItemSummary(
      workItem({
        currentState: {
          category: "WAITING",
          code: "blocked",
          name: "Blocked",
        },
        statusCategory: "WAITING",
      }),
      {
        now,
        staleThresholdDays: 3,
      },
    );

    expect(residualBlockedFields.currentStatus.exceptionHints.blocked).toBe(
      false,
    );
    expect(
      residualBlockedFields.exceptionSignals.some(
        (signal) => signal.type === "blocked",
      ),
    ).toBe(false);
    expect(blockedStateWithoutReason.currentStatus.exceptionHints.blocked).toBe(
      true,
    );
    expect(
      blockedStateWithoutReason.exceptionSignals.find(
        (signal) => signal.type === "blocked",
      ),
    ).toMatchObject({
      evidenceSource: "WORKFLOW_STATE",
    });
  });
});

function workItem(
  overrides: Partial<VersionBoardWorkItemRecord> = {},
): VersionBoardWorkItemRecord {
  return {
    assigneeId: "user_1",
    blockedAt: null,
    blockedReason: null,
    bugDetail: null,
    currentState: {
      category: "IN_PROGRESS",
      code: "in_progress",
      name: "In progress",
    },
    currentStateId: "state_1",
    dueDate: null,
    id: "work_item_1",
    intakeItemId: null,
    lastActionAt: null,
    lastStatusChangedAt: now,
    organizationId: "organization_1",
    priority: "MEDIUM",
    reporterId: "reporter_1",
    requirementId: null,
    spaceId: "space_1",
    statusCategory: "IN_PROGRESS",
    title: "Implement login",
    type: "TASK",
    versionId: "version_1",
    workflowVersionId: "workflow_version_1",
    ...overrides,
  };
}
