import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type BugView,
  type CreateBugRequest,
  type ListBugsResponse,
  type RealtimeOperation,
  type SpaceRole,
  type UpdateBugRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { removeUndefined } from "../../common/object";
import { ApiException } from "../../http/api-exception";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import { isReferenceableRequirementDocument } from "../requirement/requirement-reference-policy";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import { resolveTraceVersion } from "../trace/trace-version-policy";
import {
  canCreateBugDeliveryObject,
  canManageDeliveryObject,
  getBugCreateDeniedReason,
  getDeliveryObjectWriteDeniedReason,
} from "../workitem/delivery-object-permissions";
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
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<BugListInput, "actorUserId" | "visibility">,
    auditMetadata: AuditMetadata = {},
  ): Promise<ListBugsResponse> {
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
    const access = await this.requireBugCreator(
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

    const trace = await this.resolveTraceLinks(spaceId, {
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
      dueDate: parseOptionalDate(input.dueDate, "dueDate") ?? undefined,
      expectedResult: input.expectedResult,
      intakeItemId: input.intakeItemId,
      lastStatusChangedAt: now,
      organizationId: access.space.organizationId,
      priority: input.priority,
      relatedTaskId: input.relatedTaskId,
      relatedUserIds: collectRelatedUserIds(trace.linkedUsers),
      reporterId: actorUserId,
      requirementId: input.requirementId,
      severity: input.severity,
      spaceId,
      statusCategory: workflow.statusCategory,
      stepsToReproduce: input.stepsToReproduce,
      tagIds: input.tagIds,
      title: input.title,
      versionId: trace.versionId ?? undefined,
      workflowVersionId: workflow.workflowVersionId,
    });

    await this.safeAudit({
      ...auditMetadata,
      actionType: "CREATE",
      actorId: actorUserId,
      after: toAuditRecord(created),
      metadata: mergeAuditMetadata(auditMetadata, {
        operation: "createBug",
        workItemType: "BUG",
      }),
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "WORK_ITEM",
    });

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      target: { type: "WORK_ITEM", id: created.id },
      operation: "CREATED",
      invalidates: [
        "bug-list",
        "version-board",
        "workbench",
        "space-overview",
        "exception-view",
        "timeline",
      ],
      hints: {
        targetType: "WORK_ITEM",
        targetId: created.id,
        spaceId: created.spaceId,
        workItemType: "BUG",
        ...(created.versionId ? { versionId: created.versionId } : {}),
        ...(created.requirementId
          ? { requirementId: created.requirementId }
          : {}),
        ...(created.intakeItemId ? { intakeItemId: created.intakeItemId } : {}),
        ...(created.bugDetail.relatedTaskId
          ? {
              relatedTargetType: "WORK_ITEM" as const,
              relatedTargetId: created.bugDetail.relatedTaskId,
            }
          : {}),
      },
    });

    return {
      ...created,
      permissions: await this.workflowActions.resolvePermissionSnapshot(
        actorUserId,
        created.id,
      ),
    };
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

    if (!canManageDeliveryObject(access.role)) {
      await this.auditBugAccessDenied(
        actorUserId,
        bug,
        "updateBug",
        getDeliveryObjectWriteDeniedReason(access.role),
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
    const shouldReplaceRelatedParticipants =
      input.versionId !== undefined ||
      input.intakeItemId !== undefined ||
      input.requirementId !== undefined ||
      input.relatedTaskId !== undefined;
    const trace = shouldReplaceRelatedParticipants
      ? await this.resolveTraceLinks(bug.spaceId, {
          currentVersionId: bug.versionId,
          intakeItemId: selectOptional(input.intakeItemId, bug.intakeItemId),
          relatedTaskId:
            input.relatedTaskId !== undefined
              ? (input.relatedTaskId ?? undefined)
              : bug.bugDetail.relatedTaskId,
          requirementId: selectOptional(input.requirementId, bug.requirementId),
          versionId: input.versionId,
        })
      : undefined;
    const dueDate = parseOptionalDate(input.dueDate, "dueDate");
    const timeline = buildTimelineDiff(bug, {
      actualResult: input.actualResult,
      assigneeId: input.assigneeId,
      description: input.description,
      dueDate: toTimelineDate(dueDate),
      expectedResult: input.expectedResult,
      intakeItemId: input.intakeItemId,
      priority: input.priority,
      relatedTaskId: input.relatedTaskId,
      requirementId: input.requirementId,
      severity: input.severity,
      stepsToReproduce: input.stepsToReproduce,
      title: input.title,
      versionId: trace?.versionId,
    });
    const assigneeChanged =
      input.assigneeId !== undefined &&
      (bug.assigneeId ?? null) !== input.assigneeId;

    const updated = await this.bugs.update({
      workItemId: bugId,
      actualResult: input.actualResult,
      assigneeChanged,
      assigneeId: input.assigneeId,
      description: input.description,
      dueDate,
      expectedResult: input.expectedResult,
      intakeItemId: input.intakeItemId,
      priority: input.priority,
      relatedTaskId: input.relatedTaskId,
      relatedUserIds: collectRelatedUserIds(trace?.linkedUsers ?? []),
      requirementId: input.requirementId,
      severity: input.severity,
      shouldReplaceAssigneeParticipants: input.assigneeId !== undefined,
      shouldReplaceRelatedParticipants,
      stepsToReproduce: input.stepsToReproduce,
      timelineAfter: timeline.after,
      timelineBefore: timeline.before,
      title: input.title,
      updatedById: actorUserId,
      versionId: trace?.versionId,
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
      metadata: mergeAuditMetadata(auditMetadata, {
        operation: "updateBug",
        workItemType: "BUG",
      }),
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetId: updated.id,
      targetType: "WORK_ITEM",
    });

    const changedFields = changedFieldsFromBugUpdate(input);

    this.safePublishRealtime({
      actorId: actorUserId,
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      target: { type: "WORK_ITEM", id: updated.id },
      operation: resolveBugRealtimeOperation(changedFields),
      invalidates: [
        "bug-list",
        "version-board",
        "workbench",
        "space-overview",
        "exception-view",
        "timeline",
      ],
      hints: {
        targetType: "WORK_ITEM",
        targetId: updated.id,
        spaceId: updated.spaceId,
        workItemType: "BUG",
        ...(updated.versionId ? { versionId: updated.versionId } : {}),
        ...(updated.requirementId
          ? { requirementId: updated.requirementId }
          : {}),
        ...(updated.intakeItemId ? { intakeItemId: updated.intakeItemId } : {}),
        ...(updated.bugDetail.relatedTaskId
          ? {
              relatedTargetType: "WORK_ITEM" as const,
              relatedTargetId: updated.bugDetail.relatedTaskId,
            }
          : {}),
        changedFields,
      },
    });

    return {
      ...updated,
      permissions:
        await this.workflowActions.resolvePermissionSnapshotForKnownVisibleWorkItem(
          actorUserId,
          updated.id,
          {
            role: access.role,
            spaceOwnerId: access.space.ownerId,
          },
        ),
    };
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

  private async requireBugCreator(
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

    if (!canCreateBugDeliveryObject(access.role)) {
      await this.safeAudit({
        ...auditMetadata,
        actionType: "ACCESS_DENIED",
        actorId: userId,
        metadata: mergeAuditMetadata(auditMetadata, {
          operation,
          resultStatus: "ERROR",
          reason: getBugCreateDeniedReason(access.role),
        }),
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

  private async resolveTraceLinks(
    spaceId: string,
    input: {
      currentVersionId?: string;
      versionId?: string | null;
      requirementId?: string;
      intakeItemId?: string;
      relatedTaskId?: string;
    },
  ): Promise<{ versionId?: string | null; linkedUsers: BugLinkedUsers[] }> {
    const linkedUsers: BugLinkedUsers[] = [];

    let requirement: BugLinkedUsers | undefined;
    let intakeItem: BugLinkedUsers | undefined;
    let relatedTask: BugLinkedUsers | undefined;

    if (input.requirementId) {
      requirement = await this.requireRequirementInSpace(
        spaceId,
        input.requirementId,
      );
      linkedUsers.push(requirement);
    }
    if (input.intakeItemId) {
      intakeItem = await this.requireIntakeItemInSpace(
        spaceId,
        input.intakeItemId,
      );
      linkedUsers.push(intakeItem);
    }
    if (input.relatedTaskId) {
      relatedTask = await this.requireRelatedTaskInSpace(
        spaceId,
        input.relatedTaskId,
      );
      linkedUsers.push(relatedTask);
    }

    const versionId = resolveTraceVersion({
      currentVersionId: input.currentVersionId,
      refs: [
        { label: "requirement", versionId: requirement?.requirementVersionId },
        { label: "intakeItem", versionId: intakeItem?.intakeVersionId },
        { label: "relatedTask", versionId: relatedTask?.relatedTaskVersionId },
      ],
      requestedVersionId: input.versionId,
    });

    const participantVersionId =
      versionId === undefined ? input.currentVersionId : versionId;

    if (participantVersionId) {
      linkedUsers.push(
        await this.requireVersionInSpace(spaceId, participantVersionId),
      );
    }

    return { linkedUsers, versionId };
  }

  private async requireVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.bugs.findVersionInSpace(spaceId, versionId);

    if (!version) {
      throw new ApiException(
        "NOT_FOUND",
        "Version not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return version;
  }

  private async requireRequirementInSpace(
    spaceId: string,
    requirementId: string,
  ) {
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

    if (
      !isReferenceableRequirementDocument({
        sequence: requirement.requirementSequence,
        status: requirement.requirementStatus,
      })
    ) {
      throw new ApiException(
        "REQUIREMENT_REFERENCE_INVALID",
        "Requirement must be active before it can be linked",
        HttpStatus.BAD_REQUEST,
      );
    }

    return requirement;
  }

  private async requireIntakeItemInSpace(
    spaceId: string,
    intakeItemId: string,
  ) {
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

  private async requireRelatedTaskInSpace(
    spaceId: string,
    relatedTaskId: string,
  ) {
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
      metadata: mergeAuditMetadata(auditMetadata, {
        operation,
        resultStatus: "ERROR",
        reason,
      }),
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
      metadata: mergeAuditMetadata(auditMetadata, {
        operation,
        resultStatus: "ERROR",
        reason,
        workItemType: "BUG",
      }),
      organizationId: bug.organizationId,
      spaceId: bug.spaceId,
      targetId: bug.id,
      targetType: "WORK_ITEM",
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

  private async safeAudit(
    input: Parameters<BugRepository["createAuditLog"]>[0],
  ) {
    try {
      await this.bugs.createAuditLog(input);
    } catch (error) {
      this.logger.error(
        "Failed to write bug audit log",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private safePublishRealtime(
    input: Parameters<RealtimePublisherService["publish"]>[0],
  ) {
    try {
      this.realtime.publish(input);
    } catch (error) {
      this.logger.error(
        "Failed to publish bug realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function canReadAllSpaceBugs(role: SpaceRole) {
  return SPACE_BUG_READ_ALL_ROLES.has(role);
}

function mergeAuditMetadata(
  auditMetadata: AuditMetadata,
  metadata: Record<string, unknown>,
) {
  return {
    ...auditMetadata.metadata,
    ...metadata,
  };
}

function parseOptionalDate(value: string | null | undefined, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
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

function toTimelineDate(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : value;
}

function changedFieldsFromBugUpdate(input: UpdateBugRequest) {
  return Object.keys(input);
}

function resolveBugRealtimeOperation(changedFields: string[]): RealtimeOperation {
  if (changedFields.length === 1 && changedFields[0] === "assigneeId") {
    return "ASSIGNEE_CHANGED";
  }

  if (changedFields.length === 1 && changedFields[0] === "versionId") {
    return "VERSION_CHANGED";
  }

  return "UPDATED";
}

function selectOptional<T>(value: T | null | undefined, fallback?: T) {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? undefined : value;
}

function buildTimelineDiff(
  existing: BugView,
  next: {
    actualResult?: string | null;
    assigneeId?: string | null;
    description?: string | null;
    dueDate?: string | null;
    expectedResult?: string | null;
    intakeItemId?: string | null;
    priority?: BugView["priority"];
    relatedTaskId?: string | null;
    requirementId?: string | null;
    severity?: BugView["bugDetail"]["severity"];
    stepsToReproduce?: string | null;
    title?: string;
    versionId?: string | null;
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
  addTimelineChange(
    before,
    after,
    "priority",
    existing.priority,
    next.priority,
  );
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
    "versionId",
    existing.versionId ?? null,
    next.versionId,
  );
  addTimelineChange(
    before,
    after,
    "intakeItemId",
    existing.intakeItemId ?? null,
    next.intakeItemId,
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
