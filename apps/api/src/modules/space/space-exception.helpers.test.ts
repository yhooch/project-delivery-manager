import { describe, expect, it } from "vitest";

import {
  buildSpaceExceptionSignals,
  isPendingConfirmRecord,
  isPendingRegressionRecord,
  type SpaceExceptionWorkItemRecord,
} from "./space-exception.helpers";

const now = new Date("2026-05-13T12:00:00.000Z");

describe("space exception helpers", () => {
  it("builds all supported exception signals from explicit evidence", () => {
    const record = workItem({
      blockedAt: new Date("2026-05-11T12:00:00.000Z"),
      blockedReason: "Waiting for upstream API",
      currentState: {
        code: "waiting_pm_confirm",
        name: "Waiting PM confirm",
      },
      dueDate: new Date("2026-05-12T12:00:00.000Z"),
      lastStatusChangedAt: new Date("2026-05-09T12:00:00.000Z"),
      statusCategory: "WAITING",
    });

    expect(
      buildSpaceExceptionSignals(record, {
        now,
        staleThresholdDays: 3,
      }).map((signal) => signal.type),
    ).toEqual(["overdue", "blocked", "pending_confirm", "stale"]);
  });

  it("does not treat WAITING or VERIFYING items without confirm evidence as pending confirmation", () => {
    expect(
      isPendingConfirmRecord(
        workItem({
          currentState: {
            code: "waiting_dependency",
            name: "Waiting dependency",
          },
          statusCategory: "WAITING",
        }),
      ),
    ).toBe(false);
    expect(
      isPendingConfirmRecord(
        workItem({
          currentState: {
            code: "qa_verify",
            name: "QA verify",
          },
          statusCategory: "VERIFYING",
        }),
      ),
    ).toBe(false);
    expect(
      isPendingConfirmRecord(
        workItem({
          currentState: {
            code: "waiting_pm_confirm",
            name: "Waiting PM confirm",
          },
          statusCategory: "IN_PROGRESS",
        }),
      ),
    ).toBe(true);
  });

  it("requires an unregressed bug and regression state evidence for pending regression", () => {
    expect(
      isPendingRegressionRecord(
        workItem({
          bugDetail: {
            deletedAt: null,
            regressionAt: null,
          },
          currentState: {
            code: "ready_for_regression",
            name: "Ready for regression",
          },
          statusCategory: "IN_PROGRESS",
          type: "BUG",
        }),
      ),
    ).toBe(true);
    expect(
      isPendingRegressionRecord(
        workItem({
          bugDetail: {
            deletedAt: null,
            regressionAt: null,
          },
          currentState: {
            code: "qa_verify",
            name: "QA verify",
          },
          statusCategory: "VERIFYING",
          type: "BUG",
        }),
      ),
    ).toBe(false);
    expect(
      isPendingRegressionRecord(
        workItem({
          bugDetail: {
            deletedAt: null,
            regressionAt: new Date("2026-05-13T10:00:00.000Z"),
          },
          currentState: {
            code: "ready_for_regression",
            name: "Ready for regression",
          },
          statusCategory: "VERIFYING",
          type: "BUG",
        }),
      ),
    ).toBe(false);
  });

  it("marks items stale from lastStatusChangedAt when they reach the space threshold", () => {
    const signals = buildSpaceExceptionSignals(
      workItem({
        lastStatusChangedAt: new Date("2026-05-08T12:00:00.000Z"),
      }),
      {
        now,
        staleThresholdDays: 5,
      },
    );

    expect(signals).toEqual([
      expect.objectContaining({
        type: "stale",
        evidenceSource: "LAST_STATUS_CHANGED_AT",
        lastStatusChangedAt: "2026-05-08T12:00:00.000Z",
        staleDays: 5,
        staleThresholdDays: 5,
      }),
    ]);
  });

  it("does not mark items stale before the space threshold or after terminal states", () => {
    expect(
      buildSpaceExceptionSignals(
        workItem({
          lastStatusChangedAt: new Date("2026-05-09T12:00:00.000Z"),
        }),
        {
          now,
          staleThresholdDays: 5,
        },
      ).some((signal) => signal.type === "stale"),
    ).toBe(false);
    expect(
      buildSpaceExceptionSignals(
        workItem({
          lastStatusChangedAt: new Date("2026-05-08T12:00:00.000Z"),
          statusCategory: "DONE",
        }),
        {
          now,
          staleThresholdDays: 5,
        },
      ).some((signal) => signal.type === "stale"),
    ).toBe(false);
  });
});

function workItem(
  overrides: Partial<SpaceExceptionWorkItemRecord> = {},
): SpaceExceptionWorkItemRecord {
  return {
    blockedAt: null,
    blockedReason: null,
    bugDetail: null,
    currentState: {
      code: "in_progress",
      name: "In progress",
    },
    currentStateId: "state_1",
    dueDate: null,
    lastStatusChangedAt: now,
    statusCategory: "IN_PROGRESS",
    type: "TASK",
    ...overrides,
  };
}
