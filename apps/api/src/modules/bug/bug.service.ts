import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type BugView,
  type CreateBugRequest,
  type PageResult,
  type PermissionSnapshot,
  type SpaceRole,
  type UpdateBugRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import { BUG_REPOSITORY, type BugRepository } from "./bug.repository";
import type { AuditMetadata, BugLinkedUsers, BugListInput } from "./bug.types";

const SPACE_BUG_READ_ALL_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "TESTER",
  "VIEWER",
]);

@Injectable()
export class BugService {
  private readonly logger = new Logger(BugService.name);

  constructor(
    @Inject(BUG_REPOSITORY)
    private readonly bugs: BugRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(WorkflowActionExecutionService)
    private readonly workflowActions: WorkflowActionExecutionService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<BugListInput, "actorUserId" | "visibility">,
    auditMetadata: AuditMetadata = {},
  ): Promise<PageResult<BugView>> {
    const access = await this.requireSpaceAccess(
      actorUserId,
      spaceId,
      "listBugs",
      auditMetadata,
    );

    await this.validateListFilters(spaceId, input);

    return this.bugs.listBySpaceId(spaceId, {
      ...input,
      actorUserId,
      visibility: canReadAllSpaceBugs(access.role) ? "SPACE" : "PARTICIPANT",
    });
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateBugRequest,
    auditMetadata: AuditMetadata = {},
  ): Promise<BugView> {
    const access = await this.requireSpaceWriter(
      actorUserId,
      spaceId,
      "createBug",
      auditMetadata,
    );

    if (input.assigneeId) {
      await this.requireActiveSpaceMember(
        access.space.organizationId,
        spaceId,
        input.assigneeId,
        "Bug assignee",
      );
    }

    const linkedUsers = await this.requireLinkedTargetsInSpace(spaceId, {
      intakeItemId: input.intakeItemId,
      relatedTaskId: input.relatedTaskId,
      requirementId: input.requirementId,
      versionId: input.versionId,
    });
    const workflow = await this.bugs.resolveBugWorkflow(
      spaceId,
      input.workflowVersionId,
    );

    if (!workflow) {
      if (input.workflowVersionId) {
        throwWorkflowVersionNotFound();
      }

      throw new ApiException(
        "VALIDATION_ERROR",
        "Default BUG workflow binding is not configured",
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();
    const created = await this.bugs.create({
      id: ulid(),
      actualResult: input.actualResult,
      assigneeId: input.assigneeId,
      createdById: actorUserId,
      currentStateId: workflow.currentStateId,
      description: input.description,
      dueDate: parseOptionalDate(input.dueDate, "dueDate"),
      expectedResult: input.expectedResult,
      intakeItemId: input.intakeItemId,
      lastStatusChangedAt: now,
      organizationId: access.space.organizationId,
      priority: input.priority,
      relatedTaskId: input.relatedTaskId,
      relatedUserIds: collectRelatedUserIds(linkedUsers),
      reporterId: actorUserId,
      requirementId: input.requirementId,
      severity: input.severity,
      spaceId,
      statusCategory: workflow.statusCategory,
      stepsToReproduce: input.stepsToReproduce,
      title: input.title,
      versionId: input.versionId,
      workflowVersionId: workflow.workflowVersionId,
    });

    await this.safeAudit({
      ...auditMetadata,
      actionType: "CREATE",
      actorId: actorUserId,
      after: toAuditRecord(created),
      metadata: {
        operation: "createBug",
      },
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "BUG",
    });

    return withPermissions(created, access.role);
  }

  async get(
    actorUserId: string,
    bugId: string,
    auditMetadata: AuditMetadata = {},
  ): Promise<BugView> {
    const { bug } = await this.requireVisibleBug(
      actorUserId,
      bugId,
      "getBug",
      auditMetadata,
    );

    return {
      ...bug,
      permissions: await this.workflowActions.resolvePermissionSnapshot(
        actorUserId,
        bug.id,
      ),
    };
  }

  async update(
    actorUserId: string,
    bugId: string,
    input: UpdateBugRequest,
    auditMetadata: AuditMetadata = {},
  ): Promise<BugView> {
    const { access, bug } = await this.requireVisibleBug(
      actorUserId,
      bugId,
      "updateBug",
      auditMetadata,
    );

    if (access.role === "VIEWER") {
      await this.auditBugAccessDenied(
        actorUserId,
        bug,
        "updateBug",
        "VIEWER_READ_ONLY",
        auditMetadata,
      );
      throwSpaceAccessDenied();
    }

    if (input.assigneeId) {
      await this.requireActiveSpaceMember(
        bug.organizationId,
        bug.spaceId,
        input.assigneeId,
        "Bug assignee",
      );
    }
    if (input.regressionBy) {
      await this.requireActiveSpaceMember(
        bug.organizationId,
        bug.spaceId,
        input.regressionBy,
        "Bug regression user",
      );
    }

    if (input.versionId) {
      await this.requireVersionInSpace(bug.spaceId, input.versionId);
    }
    if (input.requirementId) {
      await this.requireRequirementInSpace(bug.spaceId, input.requirementId);
    }
    if (input.relatedTaskId) {
      await this.requireRelatedTaskInSpace(bug.spaceId, input.relatedTaskId);
    }

    const shouldReplaceRelatedParticipants =
      input.versionId !== undefined ||
      input.requirementId !== undefined ||
      input.relatedTaskId !== undefined;
    const relatedUsers = shouldReplaceRelatedParticipants
      ? await this.findLinkedTargetsInSpace(bug.spaceId, {
          intakeItemId: bug.intakeItemId,
          relatedTaskId: input.relatedTaskId ?? bug.bugDetail.relatedTaskId,
          requirementId: input.requirementId ?? bug.requirementId,
          versionId: input.versionId ?? bug.versionId,
        })
      : [];
    const dueDate = parseOptionalDate(input.dueDate, "dueDate");
    const regressionAt = parseOptionalDate(input.regressionAt, "regressionAt");
    const blockedPatch = buildBlockedPatch(bug, input);
    const timeline = buildTimelineDiff(bug, {
      actualResult: input.actualResult,
      assigneeId: input.assigneeId,
      blockedReason: blockedPatch.blockedReason,
      description: input.description,
      dueDate: dueDate?.toISOString(),
      expectedResult: input.expectedResult,
      fixNote: input.fixNote,
      priority: input.priority,
      regressionAt: regressionAt?.toISOString(),
      regressionBy: input.regressionBy,
      regressionResult: input.regressionResult,
      relatedTaskId: input.relatedTaskId,
      requirementId: input.requirementId,
      severity: input.severity,
      stepsToReproduce: input.stepsToReproduce,
      title: input.title,
      versionId: input.versionId,
    });
    const assigneeChanged =
      input.assigneeId !== undefined &&
      (bug.assigneeId ?? null) !== input.assigneeId;

    const updated = await this.bugs.update({
      workItemId: bugId,
      actualResult: input.actualResult,
      assigneeChanged,
      assigneeId: input.assigneeId,
      blockedAt: blockedPatch.blockedAt,
      blockedReason: blockedPatch.blockedReason,
      description: input.description,
      dueDate,
      expectedResult: input.expectedResult,
      fixNote: input.fixNote,
      priority: input.priority,
      regressionAt,
      regressionById: input.regressionBy,
      regressionResult: input.regressionResult,
      relatedTaskId: input.relatedTaskId,
      relatedUserIds: collectRelatedUserIds(relatedUsers),
      requirementId: input.requirementId,
      severity: input.severity,
      shouldReplaceAssigneeParticipants: input.assigneeId !== undefined,
      shouldReplaceRelatedParticipants,
      stepsToReproduce: input.stepsToReproduce,
      timelineAfter: timeline.after,
      timelineBefore: timeline.before,
      title: input.title,
      updatedById: actorUserId,
      versionId: input.versionId,
    });

    if (!updated) {
      throwBugNotFound();
    }

    await this.safeAudit({
      ...auditMetadata,
      actionType: "UPDATE",
      actorId: actorUserId,
      after: toAuditRecord(updated),
      before: toAuditRecord(bug),
      metadata: {
        operation: "updateBug",
      },
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetId: updated.id,
      targetType: "BUG",
    });

    return withPermissions(updated, access.role);
  }

  private async requireVisibleBug(
    actorUserId: string,
    bugId: string,
    operation: string,
    auditMetadata: AuditMetadata,
  ) {
    const bug = await this.bugs.findBugById(bugId);

    if (!bug) {
      throwBugNotFound();
    }

    const access = await this.spaces.findAccessibleById(
      actorUserId,
      bug.spaceId,
    );

    if (!access) {
      await this.auditBugAccessDenied(
        actorUserId,
        bug,
        operation,
        "SPACE_ACCESS_DENIED",
        auditMetadata,
      );
      throwSpaceAccessDenied();
    }

    if (
      !canReadAllSpaceBugs(access.role) &&
      !(await this.bugs.isParticipant(bug.spaceId, bug.id, actorUserId))
    ) {
      await this.auditBugAccessDenied(
        actorUserId,
        bug,
        operation,
        "NOT_PARTICIPANT",
        auditMetadata,
      );
      throwBugNotFound();
    }

    return {
      access,
      bug,
    };
  }

  private async requireSpaceAccess(
    userId: string,
    spaceId: string,
    operation: string,
    auditMetadata: AuditMetadata,
  ) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      await this.auditSpaceAccessDenied(
        userId,
        spaceId,
        operation,
        "SPACE_ACCESS_DENIED",
        auditMetadata,
      );
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireSpaceWriter(
    userId: string,
    spaceId: string,
    operation: string,
    auditMetadata: AuditMetadata,
  ) {
    const access = await this.requireSpaceAccess(
      userId,
      spaceId,
      operation,
      auditMetadata,
    );

    if (access.role === "VIEWER") {
      await this.safeAudit({
        ...auditMetadata,
        actionType: "ACCESS_DENIED",
        actorId: userId,
        metadata: {
          operation,
          reason: "VIEWER_READ_ONLY",
        },
        organizationId: access.space.organizationId,
        spaceId,
        targetId: spaceId,
        targetType: "SPACE",
      });
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async validateListFilters(
    spaceId: string,
    input: Pick<
      BugListInput,
      "intakeItemId" | "relatedTaskId" | "requirementId" | "versionId"
    >,
  ) {
    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }
    if (input.requirementId) {
      await this.requireRequirementInSpace(spaceId, input.requirementId);
    }
    if (input.intakeItemId) {
      await this.requireIntakeItemInSpace(spaceId, input.intakeItemId);
    }
    if (input.relatedTaskId) {
      await this.requireRelatedTaskInSpace(spaceId, input.relatedTaskId);
    }
  }

  private async requireLinkedTargetsInSpace(
    spaceId: string,
    input: {
      versionId?: string;
      requirementId?: string;
      intakeItemId?: string;
      relatedTaskId?: string;
    },
  ): Promise<BugLinkedUsers[]> {
    const linkedUsers: BugLinkedUsers[] = [];

    if (input.versionId) {
      linkedUsers.push(await this.requireVersionInSpace(spaceId, input.versionId));
    }
    if (input.requirementId) {
      linkedUsers.push(
        await this.requireRequirementInSpace(spaceId, input.requirementId),
      );
    }
    if (input.intakeItemId) {
      linkedUsers.push(
        await this.requireIntakeItemInSpace(spaceId, input.intakeItemId),
      );
    }
    if (input.relatedTaskId) {
      linkedUsers.push(
        await this.requireRelatedTaskInSpace(spaceId, input.relatedTaskId),
      );
    }

    return linkedUsers;
  }

  private async findLinkedTargetsInSpace(
    spaceId: string,
    input: {
      versionId?: string;
      requirementId?: string;
      intakeItemId?: string;
      relatedTaskId?: string;
    },
  ): Promise<BugLinkedUsers[]> {
    const linkedUsers: BugLinkedUsers[] = [];

    if (input.versionId) {
      const version = await this.bugs.findVersionInSpace(
        spaceId,
        input.versionId,
      );

      if (version) {
        linkedUsers.push(version);
      }
    }
    if (input.requirementId) {
      const requirement = await this.bugs.findRequirementInSpace(
        spaceId,
        input.requirementId,
      );

      if (requirement) {
        linkedUsers.push(requirement);
      }
    }
    if (input.intakeItemId) {
      const intakeItem = await this.bugs.findIntakeItemInSpace(
        spaceId,
        input.intakeItemId,
      );

      if (intakeItem) {
        linkedUsers.push(intakeItem);
      }
    }
    if (input.relatedTaskId) {
      const relatedTask = await this.bugs.findRelatedTaskInSpace(
        spaceId,
        input.relatedTaskId,
      );

      if (relatedTask) {
        linkedUsers.push(relatedTask);
      }
    }

    return linkedUsers;
  }

  private async requireVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.bugs.findVersionInSpace(spaceId, versionId);

    if (!version) {
      throw new ApiException("NOT_FOUND", "Version not found", HttpStatus.NOT_FOUND);
    }

    return version;
  }

  private async requireRequirementInSpace(spaceId: string, requirementId: string) {
    const requirement = await this.bugs.findRequirementInSpace(
      spaceId,
      requirementId,
    );

    if (!requirement) {
      throw new ApiException(
        "REQUIREMENT_NOT_FOUND",
        "Requirement not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return requirement;
  }

  private async requireIntakeItemInSpace(spaceId: string, intakeItemId: string) {
    const intakeItem = await this.bugs.findIntakeItemInSpace(
      spaceId,
      intakeItemId,
    );

    if (!intakeItem) {
      throw new ApiException(
        "INTAKE_ITEM_NOT_FOUND",
        "Intake item not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return intakeItem;
  }

  private async requireRelatedTaskInSpace(spaceId: string, relatedTaskId: string) {
    const relatedTask = await this.bugs.findRelatedTaskInSpace(
      spaceId,
      relatedTaskId,
    );

    if (!relatedTask) {
      throw new ApiException(
        "WORK_ITEM_NOT_FOUND",
        "Related task not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return relatedTask;
  }

  private async requireActiveSpaceMember(
    organizationId: string,
    spaceId: string,
    userId: string,
    label: string,
  ) {
    const organizationMember = await this.organizations.findMemberByUserId(
      organizationId,
      userId,
    );

    if (!organizationMember || organizationMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
        `${label} must belong to the same organization`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const spaceMember = await this.spaces.findMemberByUserId(spaceId, userId);

    if (!spaceMember || spaceMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        `${label} must be an active space member`,
        HttpStatus.NOT_FOUND,
      );
    }

    return spaceMember;
  }

  private async auditSpaceAccessDenied(
    actorUserId: string,
    spaceId: string,
    operation: string,
    reason: string,
    auditMetadata: AuditMetadata,
  ) {
    const context = await this.safeFindSpaceAuditContext(spaceId);

    if (!context) {
      return;
    }

    await this.safeAudit({
      ...auditMetadata,
      actionType: "ACCESS_DENIED",
      actorId: actorUserId,
      metadata: {
        operation,
        reason,
      },
      organizationId: context.organizationId,
      spaceId: context.spaceId,
      targetId: context.spaceId,
      targetType: "SPACE",
    });
  }

  private async auditBugAccessDenied(
    actorUserId: string,
    bug: BugView,
    operation: string,
    reason: string,
    auditMetadata: AuditMetadata,
  ) {
    await this.safeAudit({
      ...auditMetadata,
      actionType: "ACCESS_DENIED",
      actorId: actorUserId,
      metadata: {
        operation,
        reason,
      },
      organizationId: bug.organizationId,
      spaceId: bug.spaceId,
      targetId: bug.id,
      targetType: "BUG",
    });
  }

  private async safeFindSpaceAuditContext(spaceId: string) {
    try {
      return await this.bugs.findSpaceAuditContext(spaceId);
    } catch (error) {
      this.logger.error(
        "Failed to resolve space context for bug audit log",
        error instanceof Error ? error.stack : String(error),
      );
      return undefined;
    }
  }

  private async safeAudit(input: Parameters<BugRepository["createAuditLog"]>[0]) {
    try {
      await this.bugs.createAuditLog(input);
    } catch (error) {
      this.logger.error(
        "Failed to write bug audit log",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function canReadAllSpaceBugs(role: SpaceRole) {
  return SPACE_BUG_READ_ALL_ROLES.has(role);
}

function withPermissions(bug: BugView, role: SpaceRole): BugView {
  return {
    ...bug,
    permissions: toPermissionSnapshot(role),
  };
}

function toPermissionSnapshot(role: SpaceRole): PermissionSnapshot {
  const canWrite = role !== "VIEWER";

  return {
    availableActions: [],
    canComment: canWrite,
    canEdit: canWrite,
    canUploadAttachment: canWrite,
  };
}

function parseOptionalDate(value: string | undefined, field: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ApiException(
      "VALIDATION_ERROR",
      `${field} must be a valid date-time string`,
      HttpStatus.BAD_REQUEST,
    );
  }

  return date;
}

function buildBlockedPatch(
  existing: BugView,
  input: UpdateBugRequest,
): {
  blockedAt?: Date | null;
  blockedReason?: string | null;
} {
  if (input.blockedReason === undefined) {
    return {};
  }

  const blockedReason =
    input.blockedReason.trim().length > 0 ? input.blockedReason : null;

  if ((existing.blockedReason ?? null) === blockedReason) {
    return {
      blockedReason,
    };
  }

  return {
    blockedAt: blockedReason ? new Date() : null,
    blockedReason,
  };
}

function buildTimelineDiff(
  existing: BugView,
  next: {
    actualResult?: string;
    assigneeId?: string;
    blockedReason?: string | null;
    description?: string;
    dueDate?: string;
    expectedResult?: string;
    fixNote?: string;
    priority?: BugView["priority"];
    regressionAt?: string;
    regressionBy?: string;
    regressionResult?: string;
    relatedTaskId?: string;
    requirementId?: string;
    severity?: BugView["bugDetail"]["severity"];
    stepsToReproduce?: string;
    title?: string;
    versionId?: string;
  },
) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  addTimelineChange(before, after, "title", existing.title, next.title);
  addTimelineChange(
    before,
    after,
    "description",
    existing.description ?? null,
    next.description,
  );
  addTimelineChange(before, after, "priority", existing.priority, next.priority);
  addTimelineChange(
    before,
    after,
    "assigneeId",
    existing.assigneeId ?? null,
    next.assigneeId,
  );
  addTimelineChange(
    before,
    after,
    "dueDate",
    existing.dueDate ?? null,
    next.dueDate,
  );
  addTimelineChange(
    before,
    after,
    "blockedReason",
    existing.blockedReason ?? null,
    next.blockedReason,
  );
  addTimelineChange(
    before,
    after,
    "versionId",
    existing.versionId ?? null,
    next.versionId,
  );
  addTimelineChange(
    before,
    after,
    "requirementId",
    existing.requirementId ?? null,
    next.requirementId,
  );
  addTimelineChange(
    before,
    after,
    "severity",
    existing.bugDetail.severity,
    next.severity,
  );
  addTimelineChange(
    before,
    after,
    "stepsToReproduce",
    existing.bugDetail.stepsToReproduce ?? null,
    next.stepsToReproduce,
  );
  addTimelineChange(
    before,
    after,
    "expectedResult",
    existing.bugDetail.expectedResult ?? null,
    next.expectedResult,
  );
  addTimelineChange(
    before,
    after,
    "actualResult",
    existing.bugDetail.actualResult ?? null,
    next.actualResult,
  );
  addTimelineChange(
    before,
    after,
    "fixNote",
    existing.bugDetail.fixNote ?? null,
    next.fixNote,
  );
  addTimelineChange(
    before,
    after,
    "regressionResult",
    existing.bugDetail.regressionResult ?? null,
    next.regressionResult,
  );
  addTimelineChange(
    before,
    after,
    "regressionBy",
    existing.bugDetail.regressionBy ?? null,
    next.regressionBy,
  );
  addTimelineChange(
    before,
    after,
    "regressionAt",
    existing.bugDetail.regressionAt ?? null,
    next.regressionAt,
  );
  addTimelineChange(
    before,
    after,
    "relatedTaskId",
    existing.bugDetail.relatedTaskId ?? null,
    next.relatedTaskId,
  );

  return {
    after,
    before,
  };
}

function addTimelineChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  key: string,
  currentValue: unknown,
  nextValue: unknown,
) {
  if (nextValue === undefined || currentValue === nextValue) {
    return;
  }

  before[key] = currentValue;
  after[key] = nextValue;
}

function collectRelatedUserIds(linkedUsers: BugLinkedUsers[]) {
  const userIds = linkedUsers.flatMap((linkedUser) => [
    linkedUser.versionOwnerId,
    linkedUser.requirementOwnerId,
    linkedUser.intakeReporterId,
    linkedUser.intakeAssigneeId,
    linkedUser.relatedTaskCreatorId,
    linkedUser.relatedTaskReporterId,
    linkedUser.relatedTaskAssigneeId,
  ]);

  return Array.from(new Set(userIds.filter(Boolean))) as string[];
}

function toAuditRecord(bug: BugView): Record<string, unknown> {
  return removeUndefined({
    id: bug.id,
    type: bug.type,
    organizationId: bug.organizationId,
    spaceId: bug.spaceId,
    versionId: bug.versionId,
    requirementId: bug.requirementId,
    intakeItemId: bug.intakeItemId,
    title: bug.title,
    description: bug.description,
    priority: bug.priority,
    assigneeId: bug.assigneeId,
    reporterId: bug.reporterId,
    workflowVersionId: bug.workflowVersionId,
    currentStateId: bug.currentStateId,
    statusCategory: bug.statusCategory,
    dueDate: bug.dueDate,
    lastStatusChangedAt: bug.lastStatusChangedAt,
    lastActionAt: bug.lastActionAt,
    blockedReason: bug.blockedReason,
    blockedAt: bug.blockedAt,
    bugDetail: removeUndefined({
      workItemId: bug.bugDetail.workItemId,
      severity: bug.bugDetail.severity,
      stepsToReproduce: bug.bugDetail.stepsToReproduce,
      expectedResult: bug.bugDetail.expectedResult,
      actualResult: bug.bugDetail.actualResult,
      fixNote: bug.bugDetail.fixNote,
      regressionResult: bug.bugDetail.regressionResult,
      regressionBy: bug.bugDetail.regressionBy,
      regressionAt: bug.bugDetail.regressionAt,
      relatedTaskId: bug.bugDetail.relatedTaskId,
    }),
  });
}

function removeUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwBugNotFound(): never {
  throw new ApiException(
    "WORK_ITEM_NOT_FOUND",
    "Bug not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwWorkflowVersionNotFound(): never {
  throw new ApiException(
    "WORKFLOW_VERSION_NOT_FOUND",
    "Workflow version not found",
    HttpStatus.NOT_FOUND,
  );
}
