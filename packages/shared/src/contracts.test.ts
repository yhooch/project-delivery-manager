import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiErrorSchema,
  ApiErrorCodeSchema,
  AppSessionSchema,
  AttachmentListQuerySchema,
  BugListQuerySchema,
  BugViewSchema,
  CommentQuerySchema,
  CreateBugRequestSchema,
  CreateIntakeItemRequestSchema,
  CreateWorkflowActionRequestSchema,
  CreateWorkflowVersionRequestSchema,
  CreateWorkItemRequestSchema,
  ExecuteActionRequestSchema,
  GetAuthSessionQuerySchema,
  GetBugResponseSchema,
  GetMyWorkbenchViewResponseSchema,
  GetSpaceOverviewViewResponseSchema,
  GetWorkItemResponseSchema,
  IntakeItemSchema,
  IntakeSourceTypeSchema,
  PermissionSnapshotSchema,
  apiContracts,
  PresignAttachmentRequestSchema,
  ListSpacesResponseSchema,
  RequirementSchema,
  TimelineQuerySchema,
  UpdateBugRequestSchema,
  UpdateIntakeItemRequestSchema,
  UpdateWorkItemRequestSchema,
  UpdateRequirementRequestSchema,
  VersionSchema,
  ViewExceptionSignalSchema,
  ViewExceptionTypeSchema,
  ViewWorkItemSummarySchema,
  WorkbenchActionTodoSchema,
  WorkbenchViewQuerySchema,
  WorkflowActionSummarySchema,
  generateOpenApiDocument,
} from "./index.ts";

describe("shared contracts", () => {
  it("contains the required M0/M1/M2 error codes", () => {
    expect(ApiErrorCodeSchema.options).toEqual(
      expect.arrayContaining([
        "INTERNAL_SERVER_ERROR",
        "INVALID_CREDENTIALS",
        "RATE_LIMITED",
        "ORGANIZATION_NOT_FOUND",
        "ORGANIZATION_ACCESS_DENIED",
        "CROSS_ORGANIZATION_ACCESS_DENIED",
        "ORGANIZATION_MEMBER_NOT_FOUND",
        "LAST_ORGANIZATION_OWNER_REQUIRED",
        "TARGET_REQUIRED_FOR_ATTACHMENT",
        "ATTACHMENT_TARGET_NOT_FOUND",
        "ATTACHMENT_LIMIT_EXCEEDED",
        "FILE_TOO_LARGE",
        "UNSUPPORTED_MIME_TYPE",
        "DRAFT_REQUIREMENT_REQUIRED",
        "INTAKE_ITEM_NOT_FOUND",
        "INTAKE_ITEM_NOT_ACCEPTED",
        "INTAKE_ITEM_ALREADY_CONVERTED",
        "WORK_ITEM_NOT_FOUND",
        "WORKFLOW_ACTION_NOT_AVAILABLE",
        "WORKFLOW_ACTION_STATE_CONFLICT",
        "WORKFLOW_ACTION_PERMISSION_DENIED",
        "WORKFLOW_ACTION_FORM_INVALID",
        "WORKFLOW_ACTION_COMMENT_REQUIRED",
        "WORKFLOW_VERSION_INVALID",
        "SPACE_MEMBER_INVALID",
      ]),
    );
  });

  it("only uses declared shared error codes in endpoint contracts", () => {
    const declaredErrorCodes = new Set<string>(ApiErrorCodeSchema.options);

    for (const contract of apiContracts) {
      for (const errorCode of contract.errorCodes) {
        expect(declaredErrorCodes.has(errorCode)).toBe(true);
      }
    }
  });

  it("exposes INTERNAL_SERVER_ERROR in the ApiError JSON schema enum", () => {
    const apiErrorJsonSchema = z.toJSONSchema(ApiErrorSchema) as {
      properties?: Record<string, { enum?: string[] }>;
    };

    expect(apiErrorJsonSchema.properties?.["code"]?.enum).toEqual(
      expect.arrayContaining(["INTERNAL_SERVER_ERROR"]),
    );
  });

  it("covers backend-frozen error branches in endpoint contracts", () => {
    const errorCodesFor = (operationId: string) => {
      const contract = apiContracts.find(
        (entry) => entry.operationId === operationId,
      );

      expect(contract).toBeDefined();
      return contract?.errorCodes ?? [];
    };
    const targetResolverErrorCodes = [
      "SPACE_NOT_FOUND",
      "REQUIREMENT_NOT_FOUND",
      "INTAKE_ITEM_NOT_FOUND",
      "WORK_ITEM_NOT_FOUND",
      "NOT_FOUND",
    ];

    expect(errorCodesFor("createWorkItem")).toEqual(
      expect.arrayContaining([
        "VALIDATION_ERROR",
        "NOT_FOUND",
        "REQUIREMENT_NOT_FOUND",
        "INTAKE_ITEM_NOT_FOUND",
        "TRACE_VERSION_CONFLICT",
        "WORKFLOW_VERSION_NOT_FOUND",
      ]),
    );
    expect(errorCodesFor("createBug")).toEqual(
      expect.arrayContaining([
        "VALIDATION_ERROR",
        "NOT_FOUND",
        "REQUIREMENT_NOT_FOUND",
        "INTAKE_ITEM_NOT_FOUND",
        "WORK_ITEM_NOT_FOUND",
        "TRACE_VERSION_CONFLICT",
        "WORKFLOW_VERSION_NOT_FOUND",
      ]),
    );
    expect(errorCodesFor("updateRequirement")).toEqual(
      expect.arrayContaining([
        "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
        "TRACE_CASCADE_CONFLICT",
      ]),
    );
    expect(errorCodesFor("updateIntakeItem")).toEqual(
      expect.arrayContaining([
        "TRACE_VERSION_CONFLICT",
        "TRACE_VERSION_CHANGE_REQUIRES_CASCADE",
      ]),
    );
    expect(errorCodesFor("convertIntakeItemToWorkItems")).toEqual(
      expect.arrayContaining([
        "VALIDATION_ERROR",
        "NOT_FOUND",
        "REQUIREMENT_NOT_FOUND",
        "WORKFLOW_VERSION_NOT_FOUND",
        "INTAKE_ITEM_NOT_ACCEPTED",
        "INTAKE_ITEM_ALREADY_CONVERTED",
      ]),
    );
    expect(errorCodesFor("acceptIntakeItem")).toEqual(
      expect.arrayContaining([
        "VALIDATION_ERROR",
        "INTAKE_ITEM_NOT_FOUND",
        "INTAKE_ITEM_ALREADY_CONVERTED",
      ]),
    );
    expect(errorCodesFor("publishWorkflowVersion")).toEqual(
      expect.arrayContaining([
        "WORKFLOW_VERSION_NOT_FOUND",
        "WORKFLOW_VERSION_ALREADY_PUBLISHED",
        "WORKFLOW_VERSION_INVALID",
        "WORKFLOW_PUBLISH_VALIDATION_FAILED",
        "VALIDATION_ERROR",
      ]),
    );
    expect(errorCodesFor("createWorkflowState")).toEqual(
      expect.arrayContaining([
        "WORKFLOW_VERSION_ALREADY_PUBLISHED",
        "WORKFLOW_VERSION_INVALID",
        "CONFLICT",
        "VALIDATION_ERROR",
      ]),
    );
    expect(errorCodesFor("presignAttachment")).toEqual(
      expect.arrayContaining([
        "ATTACHMENT_TARGET_NOT_FOUND",
        "ATTACHMENT_LIMIT_EXCEEDED",
        "FILE_TOO_LARGE",
        "UNSUPPORTED_MIME_TYPE",
        "DRAFT_REQUIREMENT_REQUIRED",
        "VALIDATION_ERROR",
      ]),
    );
    expect(errorCodesFor("listAttachments")).toEqual(
      expect.arrayContaining([
        "ATTACHMENT_TARGET_NOT_FOUND",
        "VALIDATION_ERROR",
      ]),
    );
    expect(errorCodesFor("listTimeline")).toEqual(
      expect.arrayContaining(targetResolverErrorCodes),
    );
    expect(errorCodesFor("listComments")).toEqual(
      expect.arrayContaining(targetResolverErrorCodes),
    );
    expect(errorCodesFor("createComment")).toEqual(
      expect.arrayContaining(targetResolverErrorCodes),
    );
  });

  it("keeps endpoint contract operation and route identities unique", () => {
    const operationIds = new Set<string>();
    const routeKeys = new Set<string>();

    for (const contract of apiContracts) {
      expect(contract.operationId).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(operationIds.has(contract.operationId)).toBe(false);
      operationIds.add(contract.operationId);

      const routeKey = `${contract.method.toUpperCase()} ${contract.path}`;
      expect(routeKeys.has(routeKey)).toBe(false);
      routeKeys.add(routeKey);
    }

    expect(operationIds.size).toBe(apiContracts.length);
    expect(routeKeys.size).toBe(apiContracts.length);
  });

  it("covers M2 intake source, assignee and edit contracts", () => {
    expect(IntakeSourceTypeSchema.options).toEqual(
      expect.arrayContaining([
        "REQUIREMENT_CHANGE",
        "DEFECT_PROBLEM",
        "PROJECT_PLAN",
        "MEETING_DECISION",
        "AD_HOC",
        "IMPLEMENTATION",
        "OPERATIONS",
        "RELEASE",
        "EXTERNAL_COLLABORATION",
      ]),
    );

    expect(
      CreateIntakeItemRequestSchema.parse({
        title: "Clarify release scope",
        description: "Need PM triage",
        sourceType: "MEETING_DECISION",
        sourceObject: {
          meetingId: "weekly-2026-05-13",
        },
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      }),
    ).toMatchObject({
      sourceType: "MEETING_DECISION",
      assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });

    expect(
      UpdateIntakeItemRequestSchema.parse({
        description: null,
        priority: null,
        requirementId: null,
        sourceType: "REQUIREMENT_CHANGE",
        sourceObject: {
          requirementId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        },
        assigneeId: null,
        versionId: null,
        cascadeVersionChange: true,
      }),
    ).toMatchObject({
      assigneeId: null,
      cascadeVersionChange: true,
      priority: null,
      sourceType: "REQUIREMENT_CHANGE",
      versionId: null,
    });

    expect(
      IntakeItemSchema.parse({
        id: "01HRZ3NDEKTSV4RRFFQ69G5FAH",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        title: "Follow up changed requirement",
        sourceType: "REQUIREMENT_CHANGE",
        sourceObject: {
          requirementId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        },
        status: "PENDING",
        priority: "HIGH",
        reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        assigneeId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      }),
    ).toMatchObject({
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      assigneeId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
    });
  });

  it("keeps M2 work item creation task-only and requires detail permissions", () => {
    expect(
      CreateWorkItemRequestSchema.parse({
        title: "Implement task",
      }),
    ).toMatchObject({ type: "TASK" });

    expect(() =>
      CreateWorkItemRequestSchema.parse({
        type: "BUG",
        title: "Wrong entry",
      }),
    ).toThrow();

    expect(
      GetWorkItemResponseSchema.parse({
        id: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
        type: "TASK",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        title: "Implement task",
        priority: "MEDIUM",
        reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        workflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
        currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        statusCategory: "NOT_STARTED",
        lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
        permissions: {
          canEdit: true,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    ).toMatchObject({
      permissions: {
        canEdit: true,
        availableActions: [],
      },
    });
  });

  it("keeps work item lifecycle fields out of ordinary PATCH bodies", () => {
    expect(() =>
      UpdateWorkItemRequestSchema.parse({
        blockedReason: "Waiting for dependency",
      }),
    ).toThrow();

    expect(() =>
      UpdateBugRequestSchema.parse({
        blockedReason: "Waiting for dependency",
      }),
    ).toThrow();

    for (const field of [
      "fixNote",
      "regressionResult",
      "regressionBy",
      "regressionAt",
    ]) {
      expect(() =>
        UpdateBugRequestSchema.parse({
          [field]: field === "regressionAt" ? "2026-05-13T00:00:00.000Z" : "x",
        }),
      ).toThrow();
    }
  });

  it("covers M3 bug detail fields and related task filtering", () => {
    expect(
      CreateBugRequestSchema.parse({
        title: "Login regression",
        severity: "CRITICAL",
        stepsToReproduce: "Open the login page and submit a valid account.",
        expectedResult: "The user lands on the workspace.",
        actualResult: "The page returns a 500 response.",
        relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
      }),
    ).toMatchObject({
      relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
      severity: "CRITICAL",
    });

    expect(
      UpdateBugRequestSchema.parse({
        assigneeId: null,
        dueDate: null,
        severity: "MAJOR",
        relatedTaskId: null,
        requirementId: null,
        versionId: null,
        intakeItemId: null,
      }),
    ).toMatchObject({
      assigneeId: null,
      intakeItemId: null,
      relatedTaskId: null,
      versionId: null,
    });

    expect(
      BugListQuerySchema.parse({
        severity: "BLOCKER",
        relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
      }),
    ).toMatchObject({
      relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
      severity: "BLOCKER",
    });

    expect(
      BugViewSchema.parse({
        id: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
        type: "BUG",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        title: "Login regression",
        priority: "HIGH",
        reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        workflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
        currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        statusCategory: "IN_PROGRESS",
        lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
        bugDetail: {
          workItemId: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
          severity: "CRITICAL",
          stepsToReproduce: "Submit login.",
          expectedResult: "Success.",
          actualResult: "Failure.",
          fixNote: "Patch merged.",
          regressionResult: "Passed.",
          regressionBy: "01NRZ3NDEKTSV4RRFFQ69G5FAN",
          regressionAt: "2026-05-13T01:00:00.000Z",
          relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
        },
      }),
    ).toMatchObject({
      bugDetail: {
        relatedTaskId: "01MRZ3NDEKTSV4RRFFQ69G5FAM",
        severity: "CRITICAL",
      },
    });

    expect(() =>
      GetBugResponseSchema.parse({
        id: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
        type: "BUG",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        title: "Login regression",
        priority: "HIGH",
        reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        workflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
        currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        statusCategory: "IN_PROGRESS",
        lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
        bugDetail: {
          workItemId: "01PRZ3NDEKTSV4RRFFQ69G5FAP",
          severity: "CRITICAL",
        },
      }),
    ).toThrow();
  });

  it("covers M3 workflow action permissions and draft copy contracts", () => {
    const action = WorkflowActionSummarySchema.parse({
      id: "01QRZ3NDEKTSV4RRFFQ69G5FAQ",
      code: "start_fix",
      name: "Start fix",
      fromStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
      toStateId: "01RRZ3NDEKTSV4RRFFQ69G5FAR",
      allowedSpaceRoles: ["PM", "DEVELOPER"],
      actorRelations: ["ASSIGNEE"],
      requiresComment: true,
      formFields: [
        {
          id: "01SRZ3NDEKTSV4RRFFQ69G5FAS",
          key: "fixNote",
          label: "Fix note",
          fieldType: "TEXTAREA",
          required: true,
          order: 0,
        },
      ],
      order: 1,
    });

    expect(
      PermissionSnapshotSchema.parse({
        canEdit: true,
        canComment: true,
        canUploadAttachment: true,
        availableActions: [action],
      }).availableActions,
    ).toEqual([action]);

    expect(
      CreateWorkflowActionRequestSchema.parse({
        code: "start_fix",
        name: "Start fix",
        fromStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        toStateId: "01RRZ3NDEKTSV4RRFFQ69G5FAR",
        allowedSpaceRoles: ["PM", "DEVELOPER"],
        actorRelations: ["ASSIGNEE"],
        requiresComment: true,
      }),
    ).toMatchObject({
      allowedSpaceRoles: ["PM", "DEVELOPER"],
      actorRelations: ["ASSIGNEE"],
      requiresComment: true,
    });

    expect(() =>
      CreateWorkflowActionRequestSchema.parse({
        code: "viewer_fix",
        name: "Viewer fix",
        fromStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        toStateId: "01RRZ3NDEKTSV4RRFFQ69G5FAR",
        allowedSpaceRoles: ["VIEWER"],
      }),
    ).toThrow();

    expect(
      CreateWorkflowVersionRequestSchema.parse({
        sourceWorkflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
      }),
    ).toEqual({
      sourceWorkflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
    });

    expect(
      ExecuteActionRequestSchema.parse({
        comment: "Starting fix.",
        formValues: {
          fixNote: "Guard null session.",
        },
      }),
    ).toMatchObject({
      comment: "Starting fix.",
      formValues: {
        fixNote: "Guard null session.",
      },
    });
  });

  it("freezes M4 view filters, exception signals and action todo contracts", () => {
    expect(ViewExceptionTypeSchema.options).toEqual([
      "overdue",
      "blocked",
      "pending_confirm",
      "pending_regression",
      "stale",
    ]);

    expect(
      WorkbenchViewQuerySchema.parse({
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        versionId: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        statusCategory: "WAITING",
        workItemType: "BUG",
        exceptionType: "blocked",
      }),
    ).toMatchObject({
      page: 1,
      pageSize: 20,
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      exceptionType: "blocked",
      workItemType: "BUG",
    });
    expect(() =>
      WorkbenchViewQuerySchema.parse({
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      }),
    ).toThrow();

    const currentStatus = {
      workflowVersionId: "01JRZ3NDEKTSV4RRFFQ69G5FAJ",
      currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
      stateCode: "waiting_pm_confirm",
      stateName: "Waiting PM confirm",
      statusCategory: "WAITING",
      lastStatusChangedAt: "2026-05-13T00:00:00.000Z",
      exceptionHints: {
        blocked: false,
        pendingConfirm: true,
        pendingRegression: false,
      },
    };

    const workItem = ViewWorkItemSummarySchema.parse({
      id: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
      type: "BUG",
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      versionId: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
      title: "Confirm fixed login regression",
      priority: "HIGH",
      assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      reporterId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      dueDate: "2026-05-14T00:00:00.000Z",
      currentStatus,
      exceptionSignals: [
        {
          type: "pending_confirm",
          evidenceSource: "WORKFLOW_STATE",
          reason: "Workflow state explicitly requires PM confirmation.",
          currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        },
      ],
    });

    expect(workItem.currentStatus.exceptionHints.pendingConfirm).toBe(true);
    expect(workItem.exceptionSignals[0]?.type).toBe("pending_confirm");
    expect(
      ViewExceptionSignalSchema.parse({
        type: "blocked",
        evidenceSource: "WORKFLOW_STATE",
        reason: "Workflow state marks the work item blocked.",
        blockedAt: "2026-05-13T00:00:00.000Z",
        blockedReason: "Waiting for dependency",
        currentStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
      }),
    ).toMatchObject({
      evidenceSource: "WORKFLOW_STATE",
      blockedReason: "Waiting for dependency",
    });
    expect(() =>
      ViewExceptionSignalSchema.parse({
        type: "blocked",
        evidenceSource: "LEGACY_FIELD",
        reason: "Legacy fields are not a source of truth.",
      }),
    ).toThrow();

    const todo = WorkbenchActionTodoSchema.parse({
      id: "01GRZ3NDEKTSV4RRFFQ69G5FAG:01QRZ3NDEKTSV4RRFFQ69G5FAQ",
      workItem,
      currentStatus,
      availableAction: {
        id: "01QRZ3NDEKTSV4RRFFQ69G5FAQ",
        code: "confirm_fix",
        name: "Confirm fix",
        fromStateId: "01KRZ3NDEKTSV4RRFFQ69G5FAK",
        toStateId: "01RRZ3NDEKTSV4RRFFQ69G5FAR",
        allowedSpaceRoles: ["PM"],
        actorRelations: ["REPORTER"],
        requiresComment: true,
        formFields: [],
        order: 1,
      },
      actionTarget: {
        workItemId: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
        actionId: "01QRZ3NDEKTSV4RRFFQ69G5FAQ",
        executePath:
          "/work-items/01GRZ3NDEKTSV4RRFFQ69G5FAG/actions/01QRZ3NDEKTSV4RRFFQ69G5FAQ/execute",
      },
      reason: {
        code: "REPORTED_BY_ME",
        description: "The workflow action is waiting for my confirmation.",
      },
    });

    expect(todo.availableAction.code).toBe("confirm_fix");
    expect(todo.actionTarget.actionId).toBe("01QRZ3NDEKTSV4RRFFQ69G5FAQ");
    expect(todo.reason.code).toBe("REPORTED_BY_ME");

    const activity = {
      id: "01TRZ3NDEKTSV4RRFFQ69G5FAT",
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      target: {
        type: "WORK_ITEM",
        id: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
        title: "Confirm fixed login regression",
      },
      eventType: "ACTION_EXECUTED",
      actor: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "pm",
        name: "PM",
      },
      title: "Fix submitted",
      detail: "Developer submitted the fix for confirmation.",
      createdAt: "2026-05-13T02:00:00.000Z",
    };

    const emptyWorkItems = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    };
    const oneWorkItem = {
      items: [workItem],
      page: 1,
      pageSize: 20,
      total: 1,
    };

    const workbench = GetMyWorkbenchViewResponseSchema.parse({
      filters: {
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        versionId: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
        assigneeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        statusCategory: "WAITING",
        workItemType: "BUG",
        exceptionType: "pending_confirm",
      },
      stats: {
        assignedWorkItemCount: 1,
        actionTodoCount: 1,
        overdueCount: 0,
        blockedCount: 0,
        pendingConfirmCount: 1,
        pendingRegressionCount: 0,
        staleCount: 0,
      },
      sections: {
        myTodos: { title: "My todos", total: 1, items: oneWorkItem },
        assignedTasks: { title: "My tasks", total: 0, items: emptyWorkItems },
        assignedBugs: { title: "My bugs", total: 1, items: oneWorkItem },
        actionTodos: {
          title: "Action todos",
          total: 1,
          items: {
            items: [todo],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        },
        pendingConfirm: {
          title: "Pending confirm",
          total: 1,
          items: oneWorkItem,
        },
        dueSoon: { title: "Due soon", total: 1, items: oneWorkItem },
        blocked: { title: "Blocked", total: 0, items: emptyWorkItems },
        recentActivities: {
          title: "Recent activities",
          total: 1,
          items: {
            items: [activity],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        },
      },
    });

    expect(
      workbench.sections.actionTodos.items.items[0]?.availableAction.code,
    ).toBe("confirm_fix");
    expect(workbench.sections.recentActivities.items.items[0]?.eventType).toBe(
      "ACTION_EXECUTED",
    );
    expect(workbench.filters.exceptionType).toBe("pending_confirm");

    const overview = GetSpaceOverviewViewResponseSchema.parse({
      space: {
        id: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
        organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
        name: "Space A",
        code: "space-a",
        status: "ACTIVE",
        settings: {
          staleThresholdDays: 3,
        },
      },
      stats: {
        versionCount: 1,
        requirementCount: 1,
        taskCount: 1,
        completedTaskCount: 0,
        bugCount: 1,
        openBugCount: 1,
        blockedCount: 0,
        overdueCount: 0,
      },
      defaultWorkflows: [],
      statusCounts: [
        { statusCategory: "IN_PROGRESS", count: 1 },
        { statusCategory: "WAITING", count: 1 },
      ],
      taskStatusCounts: [{ statusCategory: "IN_PROGRESS", count: 1 }],
      bugStatusCounts: [{ statusCategory: "WAITING", count: 1 }],
      workItemTypeCounts: [
        { workItemType: "TASK", count: 1 },
        { workItemType: "BUG", count: 1 },
      ],
      recentActivities: {
        items: [activity],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    });

    expect(overview.recentActivities?.items[0]?.target.type).toBe("WORK_ITEM");
    expect(overview.taskStatusCounts?.[0]).toEqual({
      statusCategory: "IN_PROGRESS",
      count: 1,
    });
    expect(overview.bugStatusCounts?.[0]).toEqual({
      statusCategory: "WAITING",
      count: 1,
    });
    expect(
      overview.workItemTypeCounts?.map((item) => item.workItemType),
    ).toEqual(["TASK", "BUG"]);
  });

  it("supports M2 comments, attachments and timeline target queries", () => {
    expect(
      CommentQuerySchema.parse({
        targetType: "INTAKE_ITEM",
        targetId: "01HRZ3NDEKTSV4RRFFQ69G5FAH",
      }),
    ).toMatchObject({ targetType: "INTAKE_ITEM" });

    expect(
      AttachmentListQuerySchema.parse({
        targetType: "WORK_ITEM",
        targetId: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
      }),
    ).toMatchObject({ targetType: "WORK_ITEM" });

    expect(
      TimelineQuerySchema.parse({
        targetType: "WORK_ITEM",
        targetId: "01GRZ3NDEKTSV4RRFFQ69G5FAG",
      }),
    ).toMatchObject({ targetType: "WORK_ITEM" });
  });

  it("accepts the no-organization app session empty state", () => {
    expect(GetAuthSessionQuerySchema.parse({})).toEqual({});

    const session = AppSessionSchema.parse({
      user: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "demo_user",
        name: "demo_user",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
      },
      organizations: [],
      spaces: [],
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: false,
      },
    });

    expect(session.defaultOrganizationId).toBeUndefined();
    expect(session.defaultSpaceId).toBeUndefined();
  });

  it("accepts a multi-organization app session with a consistent default space", () => {
    const session = AppSessionSchema.parse({
      user: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "demo_user",
        name: "demo_user",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
      },
      organizations: [
        {
          id: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
          name: "Org A",
          code: "org-a",
          role: "OWNER",
          status: "ACTIVE",
        },
        {
          id: "01CRZ3NDEKTSV4RRFFQ69G5FAB",
          name: "Org B",
          code: "org-b",
          role: "MEMBER",
          status: "ACTIVE",
        },
      ],
      spaces: [
        {
          id: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
          organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
          name: "Space A",
          code: "space-a",
          role: "SPACE_ADMIN",
          status: "ACTIVE",
        },
      ],
      defaultOrganizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      defaultSpaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    });

    expect(
      session.spaces.find((space) => space.id === session.defaultSpaceId)
        ?.organizationId,
    ).toBe(session.defaultOrganizationId);
  });

  it("covers M1 version statistics and requirement related work item summaries", () => {
    const version = VersionSchema.parse({
      id: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
      organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
      spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
      name: "M1",
      target: "Deliver the M1 business container",
      ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      status: "IN_PROGRESS",
      startDate: "2026-05-13T00:00:00.000Z",
      targetDate: "2026-05-31T00:00:00.000Z",
      stats: {
        requirementCount: 1,
        taskCount: 0,
        bugCount: 0,
        blockedCount: 0,
      },
    });

    const requirement = RequirementSchema.parse({
      id: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
      organizationId: version.organizationId,
      spaceId: version.spaceId,
      versionId: version.id,
      title: "Requirement",
      contentJson: { type: "doc", content: [] },
      contentFormat: "TIPTAP_JSON",
      status: "CONFIRMED",
      relatedWorkItems: {
        taskCount: 0,
        bugCount: 0,
        tasks: [],
        bugs: [],
      },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });

    expect(version.stats.requirementCount).toBe(1);
    expect(requirement.relatedWorkItems.taskCount).toBe(0);
  });

  it("covers project space list operational summary fields", () => {
    const spaces = ListSpacesResponseSchema.parse({
      items: [
        {
          id: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
          organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
          name: "Space A",
          code: "space-a",
          ownerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          owner: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            username: "pm_user",
            name: "PM",
            status: "ACTIVE",
          },
          status: "ACTIVE",
          currentVersion: {
            id: "01ERZ3NDEKTSV4RRFFQ69G5FAD",
            organizationId: "01BRZ3NDEKTSV4RRFFQ69G5FAA",
            spaceId: "01DRZ3NDEKTSV4RRFFQ69G5FAC",
            name: "M1",
            status: "IN_PROGRESS",
            stats: {
              requirementCount: 1,
              taskCount: 2,
              bugCount: 1,
              blockedCount: 1,
            },
          },
          unfinishedTaskCount: 2,
          openBugCount: 1,
          blockedCount: 1,
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(spaces.items[0]).toMatchObject({
      owner: {
        name: "PM",
      },
      currentVersion: {
        name: "M1",
      },
      unfinishedTaskCount: 2,
      openBugCount: 1,
      blockedCount: 1,
    });
  });

  it("accepts both requirement save and archive request semantics", () => {
    expect(
      UpdateRequirementRequestSchema.parse({
        title: "Requirement",
        contentJson: { type: "doc", content: [] },
        contentText: "Requirement",
        contentMarkdownCache: "# Requirement",
      }),
    ).toMatchObject({ title: "Requirement" });

    expect(
      UpdateRequirementRequestSchema.parse({
        status: "ARCHIVED",
      }),
    ).toEqual({ status: "ARCHIVED" });
  });

  it("keeps M1 attachment request validation structural at the shared boundary", () => {
    expect(() =>
      PresignAttachmentRequestSchema.parse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "design.png",
        mimeType: "image/png",
        size: 1024,
      }),
    ).not.toThrow();

    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "payload.bin",
        mimeType: "application/octet-stream",
        size: 1024,
      }).success,
    ).toBe(true);

    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        size: 20 * 1024 * 1024 + 1,
      }).success,
    ).toBe(true);

    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "empty.txt",
        mimeType: "",
        size: 1024,
      }).success,
    ).toBe(false);

    expect(
      PresignAttachmentRequestSchema.safeParse({
        targetType: "REQUIREMENT",
        targetId: "01FRZ3NDEKTSV4RRFFQ69G5FAE",
        fileName: "fractional.pdf",
        mimeType: "application/pdf",
        size: 1024.5,
      }).success,
    ).toBe(false);
  });

  it("generates OpenAPI operations from the endpoint contract list", () => {
    const document = generateOpenApiDocument();
    const operationCount = Object.values(document.paths).reduce(
      (count, pathItem) => count + Object.keys(pathItem).length,
      0,
    );

    expect(document.openapi).toBe("3.1.0");
    expect(operationCount).toBe(apiContracts.length);
    expect(document.paths["/auth/session"]?.get?.operationId).toBe(
      "getAuthSession",
    );
    expect(document.paths["/auth/session"]?.get?.parameters).toBeUndefined();
    expect(
      document.paths["/intake-items/{id}/convert-to-work-items"]?.post
        ?.operationId,
    ).toBe("convertIntakeItemToWorkItems");
    expect(document.paths["/intake-items/{id}"]?.get?.operationId).toBe(
      "getIntakeItem",
    );
    expect(document.paths["/intake-items/{id}"]?.patch?.operationId).toBe(
      "updateIntakeItem",
    );
    expect(document.paths["/work-items/{workItemId}"]?.get?.operationId).toBe(
      "getWorkItem",
    );
    expect(
      document.paths["/requirements/{requirementId}"]?.delete?.operationId,
    ).toBe("deleteRequirementDraft");
    expect(
      document.paths["/requirements/{requirementId}"]?.delete?.requestBody,
    ).toBeUndefined();
    expect(document.paths["/spaces/{spaceId}/bugs"]?.post?.operationId).toBe(
      "createBug",
    );
    expect(document.paths["/spaces/{spaceId}/bugs"]?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "severity", in: "query" }),
        expect.objectContaining({ name: "relatedTaskId", in: "query" }),
      ]),
    );
    expect(document.paths["/bugs/{id}"]).toBeUndefined();
    expect(document.paths["/bugs/{bugId}"]?.get?.operationId).toBe("getBug");
    expect(document.paths["/bugs/{bugId}"]?.patch?.operationId).toBe(
      "updateBug",
    );
    expect(document.paths["/bugs/{bugId}"]?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "bugId",
          in: "path",
          required: true,
        }),
      ]),
    );
    expect(document.paths["/workflows/{workflowId}"]?.get?.operationId).toBe(
      "getWorkflow",
    );
    expect(
      document.paths["/workflow-versions/{workflowVersionId}"]?.get
        ?.operationId,
    ).toBe("getWorkflowVersion");
    expect(
      document.paths["/spaces/{spaceId}/workflow-bindings"]?.get?.operationId,
    ).toBe("listWorkflowBindings");
    expect(
      document.paths["/work-items/{workItemId}/actions/{actionId}/execute"]
        ?.post?.["x-error-codes"],
    ).toEqual(
      expect.arrayContaining([
        "WORKFLOW_ACTION_NOT_AVAILABLE",
        "WORKFLOW_ACTION_PERMISSION_DENIED",
        "WORKFLOW_ACTION_FORM_INVALID",
        "WORKFLOW_ACTION_COMMENT_REQUIRED",
        "WORKFLOW_VERSION_INVALID",
        "SPACE_MEMBER_INVALID",
      ]),
    );
    expect(
      document.paths["/views/spaces/{spaceId}/overview"]?.get?.operationId,
    ).toBe("getSpaceOverview");
    expect(document.paths["/views/my-workbench"]?.get?.operationId).toBe(
      "getMyWorkbenchView",
    );
    expect(document.paths["/views/my-workbench"]?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "organizationId",
          in: "query",
          required: true,
        }),
        expect.objectContaining({ name: "spaceId", in: "query" }),
        expect.objectContaining({ name: "versionId", in: "query" }),
        expect.objectContaining({ name: "assigneeId", in: "query" }),
        expect.objectContaining({ name: "statusCategory", in: "query" }),
        expect.objectContaining({ name: "workItemType", in: "query" }),
        expect.objectContaining({ name: "exceptionType", in: "query" }),
      ]),
    );
    expect(
      document.paths["/views/versions/{versionId}/board"]?.get?.operationId,
    ).toBe("getVersionBoardView");
    expect(
      document.paths["/views/spaces/{spaceId}/exceptions"]?.get?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "versionId", in: "query" }),
        expect.objectContaining({ name: "assigneeId", in: "query" }),
        expect.objectContaining({ name: "statusCategory", in: "query" }),
        expect.objectContaining({ name: "workItemType", in: "query" }),
        expect.objectContaining({ name: "exceptionType", in: "query" }),
      ]),
    );
    expect(
      document.paths["/attachments/presign"]?.post?.["x-error-codes"],
    ).toContain("DRAFT_REQUIREMENT_REQUIRED");
  });
});
