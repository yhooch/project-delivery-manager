import type { ViewWorkItemSummary, WorkItem } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import { toWorkItemListViewModel, toWorkItemViewModel } from "./work-item-view-model";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    type: "TASK",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Waiting task",
    priority: "MEDIUM",
    reporterId: "USR_REPORTER",
    workflowVersionId: "WF_01",
    currentStateId: "STATE_WAITING",
    statusCategory: "WAITING",
    lastStatusChangedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

function makeSummary(
  overrides: Partial<ViewWorkItemSummary> = {},
): ViewWorkItemSummary {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
    type: "TASK",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Waiting summary",
    priority: "MEDIUM",
    assigneeId: null,
    versionId: null,
    dueDate: null,
    lastActionAt: null,
    currentStatus: {
      statusCategory: "WAITING",
      stateName: "Waiting",
    },
    exceptionSignals: [],
    ...overrides,
  } as unknown as ViewWorkItemSummary;
}

describe("work item view models", () => {
  it("does not mark WAITING list items as blocked without blockedAt", () => {
    const viewModel = toWorkItemListViewModel(makeWorkItem(), {
      locale: "zh-CN",
    });

    expect(viewModel.statusCategory).toBe("WAITING");
    expect(viewModel.isBlocked).toBe(false);
  });

  it("marks list items as blocked when blockedAt is present", () => {
    const viewModel = toWorkItemListViewModel(
      makeWorkItem({
        blockedAt: "2026-05-02T00:00:00.000Z",
        blockedReason: "Waiting for review",
      } as Partial<WorkItem>),
      { locale: "zh-CN" },
    );

    expect(viewModel.isBlocked).toBe(true);
    expect(viewModel.blockedReason).toBe("Waiting for review");
  });

  it("uses explicit blocked exception signals for view summaries", () => {
    expect(
      toWorkItemViewModel(makeSummary(), { locale: "zh-CN" }).isBlocked,
    ).toBe(false);

    expect(
      toWorkItemViewModel(
        makeSummary({
          exceptionSignals: [
            { type: "blocked", reason: "Waiting for API" },
          ],
        } as Partial<ViewWorkItemSummary>),
        { locale: "zh-CN" },
      ).isBlocked,
    ).toBe(true);
  });
});
