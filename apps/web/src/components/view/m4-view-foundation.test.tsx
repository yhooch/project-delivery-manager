// @vitest-environment jsdom

import type { ViewWorkItemSummary } from "@project-delivery/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExceptionTypeTag,
  StatusCategoryColumn,
  ViewEmptyState,
  WorkItemSummaryCard,
} from "./m4-view-foundation";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => {
    return (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${values.count}`;
  },
}));

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5F10";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5F11";
const versionId = "01ARZ3NDEKTSV4RRFFQ69G5F12";
const workItemId = "01ARZ3NDEKTSV4RRFFQ69G5F13";
const reporterId = "01ARZ3NDEKTSV4RRFFQ69G5F14";
const assigneeId = "01ARZ3NDEKTSV4RRFFQ69G5F15";
const workflowVersionId = "01ARZ3NDEKTSV4RRFFQ69G5F16";
const stateId = "01ARZ3NDEKTSV4RRFFQ69G5F17";

describe("M4 view foundation components", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders status category columns with message keys and empty state", () => {
    render(createElement(StatusCategoryColumn, {
      statusCategory: "WAITING",
      total: 0,
    }));

    expect(screen.getByText("m4Views.column.eyebrow")).toBeTruthy();
    expect(screen.getByText("m4Views.statusCategory.WAITING")).toBeTruthy();
    expect(screen.getByText("m4Views.column.total:0")).toBeTruthy();
    expect(screen.getByText("m4Views.empty.column.title")).toBeTruthy();
  });

  it("renders exception type tags from translation keys", () => {
    render(createElement(ExceptionTypeTag, { type: "pending_regression" }));

    expect(
      screen.getByText("m4Views.exceptionType.pending_regression"),
    ).toBeTruthy();
  });

  it("renders a work item card summary without page-specific layout", () => {
    render(createElement(WorkItemSummaryCard, {
      assigneeName: "Ada Lovelace",
      item: createWorkItem(),
      reporterName: "Grace Hopper",
      versionName: "M4",
    }));

    expect(screen.getByText("Prepare release")).toBeTruthy();
    expect(screen.getByText("m4Views.workItemType.TASK")).toBeTruthy();
    expect(screen.getByText("m4Views.priority.HIGH")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("M4")).toBeTruthy();
    expect(screen.getByText("m4Views.exceptionType.blocked")).toBeTruthy();
  });

  it("renders configurable empty state copy from message keys", () => {
    render(createElement(ViewEmptyState, {
      descriptionKey: "m4Views.empty.view.description",
      titleKey: "m4Views.empty.view.title",
    }));

    expect(screen.getByText("m4Views.empty.view.title")).toBeTruthy();
    expect(screen.getByText("m4Views.empty.view.description")).toBeTruthy();
  });
});

function createWorkItem(): ViewWorkItemSummary {
  return {
    assigneeId,
    currentStatus: {
      currentStateId: stateId,
      exceptionHints: {
        blocked: true,
        pendingConfirm: false,
        pendingRegression: false,
      },
      lastStatusChangedAt: "2026-05-13T10:00:00.000Z",
      stateCode: "blocked",
      stateName: "Blocked",
      statusCategory: "WAITING",
      workflowVersionId,
    },
    dueDate: "2026-05-14T10:00:00.000Z",
    exceptionSignals: [
      {
        blockedReason: "Waiting for approval",
        evidenceSource: "BLOCKED_FIELD",
        reason: "Blocked by dependency",
        type: "blocked",
      },
    ],
    id: workItemId,
    organizationId,
    priority: "HIGH",
    reporterId,
    spaceId,
    title: "Prepare release",
    type: "TASK",
    versionId,
  };
}
