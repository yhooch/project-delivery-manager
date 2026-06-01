import { describe, expect, it, vi } from "vitest";

import {
  formatTimelineEvent,
  getTimelineEventLabel,
  type TimelineMessageTranslator,
} from "./timeline-display";

const timelineMessages = new Map<string, string>(
  Object.entries({
    "common.timeline.change.field.title": "标题",
    "common.timeline.change.field.description": "描述",
    "common.timeline.change.field.priority": "优先级",
    "common.timeline.change.field.assigneeId": "负责人",
    "common.timeline.change.field.ownerId": "负责人",
    "common.timeline.change.field.reporterId": "报告人",
    "common.timeline.change.field.versionId": "版本",
    "common.timeline.change.field.requirementId": "需求",
    "common.timeline.change.field.intakeItemId": "事项",
    "common.timeline.change.field.status": "状态",
    "common.timeline.change.field.statusCategory": "状态归类",
    "common.timeline.change.field.currentStateId": "流程状态",
    "common.timeline.change.field.blockedAt": "阻塞时间",
    "common.timeline.change.field.blockedReason": "阻塞原因",
    "common.timeline.change.field.closedAt": "关闭时间",
    "common.timeline.change.field.dueDate": "截止日期",
    "common.timeline.change.field.severity": "严重程度",
    "common.timeline.change.field.expectedResult": "预期结果",
    "common.timeline.change.field.actualResult": "实际结果",
    "common.timeline.change.field.stepsToReproduce": "复现步骤",
    "common.timeline.change.field.relatedTaskId": "关联任务",
    "common.timeline.change.field.convertedAt": "转化时间",
    "common.timeline.change.value.empty": "空",
    "common.timeline.change.value.reference": "已设置",
    "common.timeline.change.value.priority.MEDIUM": "中",
    "common.timeline.change.value.priority.HIGH": "高",
    "common.timeline.change.value.status.CONFIRMED": "已确认",
    "common.timeline.change.value.status.ARCHIVED": "已归档",
    "common.timeline.documentOperation.ARCHIVED": "归档",
    "common.timeline.documentOperation.DELETED": "删除",
    "common.timeline.documentOperation.RESTORED": "恢复",
    "common.timeline.change.value.statusCategory.NOT_STARTED": "未开始",
    "common.timeline.change.value.statusCategory.WAITING": "等待中",
    "common.timeline.change.value.severity.BLOCKER": "阻断",
    "common.timeline.change.value.severity.MAJOR": "主要",
    "common.workflowDefaults.actions.START_PROGRESS": "开始处理",
    "common.workflowDefaults.fields.blockedReason": "阻塞原因",
    "common.workflowDefaults.fields.fixAssigneeId": "修复负责人",
    "common.workflowDefaults.fields.regressionConclusion": "回归结论",
    "common.workflowDefaults.fieldOptions.regressionConclusion.REGRESSION_FAILED":
      "回归不通过",
    "common.workflowDefaults.states.PENDING": "待处理",
    "common.workflowDefaults.states.DONE": "已完成",
  }),
);

const translateMessage = ((key: string) =>
  timelineMessages.get(key) ?? key) as TimelineMessageTranslator;
translateMessage.has = (key: string) => timelineMessages.has(key);

function makeEvent(overrides = {}) {
  return {
    actor: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      name: "Ada",
      username: "ada",
    },
    createdAt: "2026-05-13T10:00:00.000Z",
    eventType: "UPDATED",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
    organizationId: "01ARZ3NDEKTSV4RRFFQ69G5FA3",
    spaceId: "01ARZ3NDEKTSV4RRFFQ69G5FA4",
    target: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
      title: "Target task",
      type: "WORK_ITEM",
    },
    title: "Updated target",
    ...overrides,
  } as Parameters<typeof formatTimelineEvent>[0];
}

describe("timeline display", () => {
  it("uses the localized label for known timeline event types", () => {
    expect(getTimelineEventLabel("CREATED", (key) => `timeline.${key}`)).toBe(
      "timeline.CREATED",
    );
  });

  it("throws missing translation in non-production", () => {
    expect(() =>
      getTimelineEventLabel("ACTION_EXECUTED", () => {
        throw new Error("missing translation");
      }),
    ).toThrow("missing translation");
  });

  it("falls back to the event type in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      getTimelineEventLabel("ACTION_EXECUTED", () => {
        throw new Error("missing translation");
      }),
    ).toBe("ACTION_EXECUTED");
    vi.unstubAllEnvs();
  });

  it("builds a unified display model from detail, target and href", () => {
    const display = formatTimelineEvent(
      makeEvent({
        detail: "Severity changed",
        metadata: { workItemType: "BUG" },
      }),
      {
        href: "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5",
        translateEventType: (key) => `timeline.${key}`,
      },
    );

    expect(display).toMatchObject({
      actionLabel: "timeline.UPDATED",
      detail: "Severity changed",
      href: "/bugs?bugId=01ARZ3NDEKTSV4RRFFQ69G5FA5",
      summary: "Target task",
      targetTitle: "Target task",
      time: "2026-05-13T10:00:00.000Z",
    });
    expect(display.actor).toMatchObject({ initial: "A", name: "Ada" });
  });

  it("does not use the persisted event title as fallback system copy", () => {
    const display = formatTimelineEvent(
      makeEvent({
        target: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
          type: "WORK_ITEM",
        },
        title: "保存需求",
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.actionLabel).toBe("timeline.UPDATED");
    expect(display.summary).toBe("");
    expect(display.summary).not.toBe("保存需求");
  });

  it("uses document lifecycle operation labels before generic event labels", () => {
    const archived = formatTimelineEvent(
      makeEvent({
        eventType: "STATUS_CHANGED",
        metadata: {
          operation: "ARCHIVED",
        },
        target: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
          title: "方案文档",
          type: "DOCUMENT",
        },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );
    const deleted = formatTimelineEvent(
      makeEvent({
        eventType: "UPDATED",
        metadata: {
          operation: "DELETED",
        },
        target: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
          title: "方案文档",
          type: "DOCUMENT",
        },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    expect(archived.actionLabel).toBe("归档");
    expect(deleted.actionLabel).toBe("删除");
    expect(archived.summary).toBe("方案文档");
    expect(deleted.summary).toBe("方案文档");
  });

  it("prefers workflow action metadata and surfaces form values", () => {
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "ACTION_EXECUTED",
        metadata: {
          actionCode: "APPROVE",
          actionName: "Approve",
          formValues: {
            note: "Ready to ship",
            reviewer: "Grace",
          },
        },
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.actionLabel).toBe("Approve");
    expect(display.detail).toContain("Note: Ready to ship");
    expect(display.secondary).toBeUndefined();
  });

  it("localizes default workflow actions and form field values", () => {
    const rawReference = "01ARZ3NDEKTSV4RRFFQ69G5USR";
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "ACTION_EXECUTED",
        metadata: {
          actionCode: "START_PROGRESS",
          actionName: "Start progress",
          formValues: {
            blockedReason: "WAITING_API",
            fixAssigneeId: rawReference,
            regressionConclusion: "REGRESSION_FAILED",
          },
        },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    expect(display.actionLabel).toBe("开始处理");
    expect(display.detail).toContain("阻塞原因: Waiting Api");
    expect(display.detail).toContain("修复负责人: 已设置");
    expect(display.detail).toContain("回归结论: 回归不通过");
    expect(display.detail).not.toContain("blockedReason");
    expect(display.detail).not.toContain(rawReference);
    expect(display.detail).not.toContain("REGRESSION_FAILED");
  });

  it("uses commentPreview as commented summary without duplicating it as detail", () => {
    const display = formatTimelineEvent(
      makeEvent({
        detail: "客户确认优先处理",
        eventType: "COMMENTED",
        metadata: {
          commentPreview: "客户确认优先处理",
        },
        title: "Commented",
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.actionLabel).toBe("timeline.COMMENTED");
    expect(display.summary).toBe("客户确认优先处理");
    expect(display.detail).toBeUndefined();
  });

  it("falls back to target title before generic commented title", () => {
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "COMMENTED",
        target: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FA5",
          title: "中文目标事项",
          type: "WORK_ITEM",
        },
        title: "Commented",
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.summary).toBe("中文目标事项");
  });

  it("uses fileName as attachment summary and keeps file metadata in detail", () => {
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "ATTACHMENT_ADDED",
        metadata: {
          fileName: "错误截图.png",
          mimeType: "image/png",
          size: 2048,
        },
        title: "Attachment added",
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.summary).toBe("错误截图.png");
    expect(display.detail).toBe("image/png / 2 KB");
    expect(display.detail).not.toContain("错误截图.png");
  });

  it("avoids repeating action label as action-like summary", () => {
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "ACTION_EXECUTED",
        metadata: {
          actionName: "Approve",
          actionCode: "APPROVE",
        },
        title: "Approve",
      }),
      { translateEventType: (key) => `timeline.${key}` },
    );

    expect(display.actionLabel).toBe("Approve");
    expect(display.summary).toBe("Target task");
    expect(display.detail).toBeUndefined();
  });

  it("surfaces changedFields metadata when before and after are absent", () => {
    const display = formatTimelineEvent(
      makeEvent({
        eventType: "UPDATED",
        metadata: {
          changedFields: ["priority", "assigneeId"],
        },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    expect(display.changes).toEqual([
      { after: "空", before: "空", field: "优先级" },
      { after: "空", before: "空", field: "负责人" },
    ]);
  });

  it("lists changed before and after fields with translated keys and values", () => {
    const display = formatTimelineEvent(
      makeEvent({
        after: { priority: "HIGH", title: "New title" },
        before: { priority: "MEDIUM", title: "Old title" },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    expect(display.changes).toEqual([
      { after: "高", before: "中", field: "优先级" },
      { after: "New title", before: "Old title", field: "标题" },
    ]);
  });

  it("keeps full multiline text values in field changes", () => {
    const longBefore =
      "Before line one keeps important context that should not be clipped\nBefore line two keeps the reproduction notes";
    const longAfter =
      "After line one keeps the updated context that should not be clipped\nAfter line two keeps the verification notes";
    const display = formatTimelineEvent(
      makeEvent({
        after: { description: longAfter },
        before: { description: longBefore },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    expect(display.changes).toEqual([
      { after: longAfter, before: longBefore, field: "描述" },
    ]);
  });

  it("covers common timeline change fields without exposing raw keys", () => {
    const rawReference = "01ARZ3NDEKTSV4RRFFQ69G5RAW";
    const rawBeforeState = "01ARZ3NDEKTSV4RRFFQ69G5OLD";
    const display = formatTimelineEvent(
      makeEvent({
        after: {
          actualResult: "Actual result",
          assigneeId: rawReference,
          blockedAt: "2026-05-13T12:00:00.000Z",
          blockedReason: "Waiting on API",
          closedAt: "2026-05-14T12:00:00.000Z",
          convertedAt: "2026-05-15T12:00:00.000Z",
          currentStateId: rawReference,
          description: "New description",
          dueDate: "2026-05-20",
          expectedResult: "Expected result",
          intakeItemId: rawReference,
          ownerId: rawReference,
          priority: "HIGH",
          relatedTaskId: rawReference,
          reporterId: rawReference,
          requirementId: rawReference,
          severity: "BLOCKER",
          status: "ARCHIVED",
          statusCategory: "WAITING",
          stepsToReproduce: "Step 1",
          title: "New title",
          versionId: rawReference,
        },
        before: {
          actualResult: "",
          assigneeId: null,
          blockedAt: null,
          blockedReason: "",
          closedAt: null,
          convertedAt: null,
          currentStateId: rawBeforeState,
          description: "Old description",
          dueDate: null,
          expectedResult: "",
          intakeItemId: null,
          ownerId: null,
          priority: "MEDIUM",
          relatedTaskId: null,
          reporterId: null,
          requirementId: null,
          severity: "MAJOR",
          status: "CONFIRMED",
          statusCategory: "NOT_STARTED",
          stepsToReproduce: "",
          title: "Old title",
          versionId: null,
        },
        metadata: {
          fromStateCode: "PENDING",
          toStateCode: "DONE",
        },
      }),
      {
        translateEventType: (key) => `timeline.${key}`,
        translateMessage,
      },
    );

    const renderedChanges = JSON.stringify(display.changes);

    expect(renderedChanges).not.toContain("priority");
    expect(renderedChanges).not.toContain("assigneeId");
    expect(renderedChanges).not.toContain("currentStateId");
    expect(renderedChanges).not.toContain("ownerId");
    expect(renderedChanges).not.toContain("HIGH");
    expect(renderedChanges).not.toContain("BLOCKER");
    expect(renderedChanges).not.toContain("NOT_STARTED");
    expect(renderedChanges).not.toContain(rawReference);
    expect(renderedChanges).not.toContain(rawBeforeState);
    expect(display.changes).toEqual(
      expect.arrayContaining([
        { after: "高", before: "中", field: "优先级" },
        { after: "已设置", before: "空", field: "负责人" },
        { after: "已完成", before: "待处理", field: "流程状态" },
        { after: "阻断", before: "主要", field: "严重程度" },
        { after: "等待中", before: "未开始", field: "状态归类" },
      ]),
    );
  });
});
