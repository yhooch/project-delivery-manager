import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  type CreateWorkItemRequest,
  type ListWorkItemsResponse,
  type SpaceRole,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemDetail,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { auditAccessDenied } from "../audit/audit-access-denied";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  WORK_ITEM_REPOSITORY,
  type WorkItemRepository,
} from "./workitem.repository";
import { WorkflowActionExecutionService } from "../workflow/workflow-action-execution.service";
import {
  hasTraceVersionCascadeImpact,
  hasTraceVersionChange,
  resolveTraceVersion,
  throwTraceVersionChangeRequiresCascade,
} from "../trace/trace-version-policy";
import type {
  WorkItemLinkedUsers,
  WorkItemListInput,
  WorkItemVersionCascadeImpact,
} from "./workitem.types";
import { toWorkItemDetail } from "./workitem.mappers";
import { canReadAllSpaceWorkItems } from "./workitem-visibility";
import {
  canCreateTaskDeliveryObject,
  canManageDeliveryObject,
} from "./delivery-object-permissions";

@Injectable()
export class WorkItemService {
  constructor(
    @Inject(WORK_ITEM_REPOSITORY)
    private readonly workItems: WorkItemRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(WorkflowActionExecutionService)
    private readonly workflowActions: WorkflowActionExecutionService,
    @Inject(AuditService)
    private readonly audit: AuditService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<WorkItemListInput, "actorUserId" | "visibility">,
  ): Promise<ListWorkItemsResponse> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    await this.validateListFilters(spaceId, input);

    return this.workItems.listBySpaceId(spaceId, {
      ...input,
      actorUserId,
      visibility: resolveWorkItemVisibility(access.role),
    });
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateWorkItemRequest,
    metadata: RequestMetadata = {},
  ): Promise<WorkItem> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    if (input.type !== "TASK") {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Only TASK work items can be created in M2",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!canCreateTaskDeliveryObject(access.role)) {
      await auditAccessDenied(this.audit, {
        ...metadata,
        actorId: actorUserId,
        metadata: { role: access.role },
        operation: "createWorkItem",
        organizationId: access.space.organizationId,
        reason: "ROLE_NOT_ALLOWED",
        spaceId,
        targetId: spaceId,
        targetType: "SPACE",
      });
      throwSpaceAccessDenied();
    }

    if (input.assigneeId) {
      await this.requireActiveSpaceMember(
        access.space.organizationId,
        spaceId,
        input.assigneeId,
        "Task assignee",
      );
    }

    const trace = await this.resolveTraceLinks(spaceId, {
      intakeItemId: input.intakeItemId,
      requirementId: input.requirementId,
      versionId: input.versionId,
    });
    const workflow = await this.workItems.resolveTaskWorkflow(
      spaceId,
      input.workflowVersionId,
    );

    if (!workflow) {
      if (input.workflowVersionId) {
        throwWorkflowVersionNotFound();
      }

      throw new ApiException(
        "VALIDATION_ERROR",
        "Default TASK workflow binding is not configured",
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();

    const created = await this.workItems.create({
      id: ulid(),
      assigneeId: input.assigneeId,
      createdById: actorUserId,
      currentStateId: workflow.currentStateId,
      description: input.description,
      dueDate: parseOptionalDate(input.dueDate, "dueDate") ?? undefined,
      intakeItemId: input.intakeItemId,
      lastStatusChangedAt: now,
      organizationId: access.space.organizationId,
      priority: input.priority,
      relatedUserIds: collectRelatedUserIds(trace.linkedUsers),
      reporterId: actorUserId,
      requirementId: input.requirementId,
      spaceId,
      statusCategory: workflow.statusCategory,
      tagIds: input.tagIds,
      title: input.title,
      versionId: trace.versionId ?? undefined,
      workflowVersionId: workflow.workflowVersionId,
    });

    await this.audit.record({
      actionType: "CREATE",
      actorId: actorUserId,
      after: created,
      ...metadata,
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "WORK_ITEM",
    });

    return created;
  }

  async get(actorUserId: string, workItemId: string): Promise<WorkItemDetail> {
    const { workItem } = await this.requireVisibleWorkItem(
      actorUserId,
      workItemId,
    );

    return toWorkItemDetail(
      workItem,
      await this.workflowActions.resolvePermissionSnapshot(
        actorUserId,
        workItem.id,
      ),
    );
  }

  async update(
    actorUserId: string,
    workItemId: string,
    input: UpdateWorkItemRequest,
    metadata: RequestMetadata = {},
  ): Promise<WorkItem> {
    const { access, workItem } = await this.requireVisibleWorkItem(
      actorUserId,
      workItemId,
    );

    if (!canManageDeliveryObject(access.role)) {
      await auditAccessDenied(this.audit, {
        ...metadata,
        actorId: actorUserId,
        metadata: { role: access.role },
        operation: "updateWorkItem",
        organizationId: workItem.organizationId,
        reason: "ROLE_NOT_ALLOWED",
        spaceId: workItem.spaceId,
        targetId: workItem.id,
        targetType: "WORK_ITEM",
      });
      throwSpaceAccessDenied();
    }

    if (input.assigneeId) {
      await this.requireActiveSpaceMember(
        workItem.organizationId,
        workItem.spaceId,
        input.assigneeId,
        "Task assignee",
      );
    }

    const shouldReplaceRelatedParticipants =
      input.versionId !== undefined ||
      input.requirementId !== undefined ||
      input.intakeItemId !== undefined;
    const trace = shouldReplaceRelatedParticipants
      ? await this.resolveTraceLinks(workItem.spaceId, {
          currentVersionId: workItem.versionId,
          intakeItemId: selectOptional(
            input.intakeItemId,
            workItem.intakeItemId,
          ),
          requirementId: selectOptional(
            input.requirementId,
            workItem.requirementId,
          ),
          versionId: input.versionId,
        })
      : undefined;
    const dueDate = parseOptionalDate(input.dueDate, "dueDate");
    const timeline = buildTimelineDiff(workItem, {
      assigneeId: input.assigneeId,
      description: input.description,
      dueDate: toTimelineDate(dueDate),
      intakeItemId: input.intakeItemId,
      priority: input.priority,
      requirementId: input.requirementId,
      title: input.title,
      versionId: trace?.versionId,
    });
    const versionCascadeImpact = hasTraceVersionChange(
      workItem.versionId,
      trace?.versionId,
    )
      ? await this.countVersionCascadeImpact({
          nextVersionId: trace?.versionId ?? null,
          workItemId,
        })
      : undefined;

    if (
      versionCascadeImpact &&
      hasTraceVersionCascadeImpact(versionCascadeImpact) &&
      input.cascadeVersionChange !== true
    ) {
      throwTraceVersionChangeRequiresCascade({
        fromVersionId: workItem.versionId,
        impact: versionCascadeImpact,
        targetId: workItemId,
        targetType: "TASK",
        toVersionId: trace?.versionId ?? null,
      });
    }

    const updated = await this.workItems.update({
      workItemId,
      assigneeId: input.assigneeId,
      cascadeVersionChange: input.cascadeVersionChange,
      description: input.description,
      dueDate,
      intakeItemId: input.intakeItemId,
      priority: input.priority,
      relatedUserIds: collectRelatedUserIds(trace?.linkedUsers ?? []),
      requirementId: input.requirementId,
      shouldReplaceAssigneeParticipants: input.assigneeId !== undefined,
      shouldReplaceRelatedParticipants,
      timelineAfter: timeline.after,
      timelineBefore: timeline.before,
      title: input.title,
      updatedById: actorUserId,
      versionId: trace?.versionId,
    });

    if (!updated) {
      throwWorkItemNotFound();
    }

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: updated,
      before: workItem,
      metadata: {
        operation: "UPDATE_FIELDS",
        ...(input.cascadeVersionChange === true && versionCascadeImpact
          ? { versionCascade: toCascadeAuditMetadata(versionCascadeImpact) }
          : {}),
      },
      ...metadata,
      organizationId: workItem.organizationId,
      spaceId: workItem.spaceId,
      targetId: workItemId,
      targetType: "WORK_ITEM",
    });

    return updated;
  }

  private async requireVisibleWorkItem(
    actorUserId: string,
    workItemId: string,
  ) {
    const workItem = await this.workItems.findTaskById(workItemId);

    if (!workItem) {
      throwWorkItemNotFound();
    }

    const access = await this.requireSpaceAccess(actorUserId, workItem.spaceId);

    if (
      !canReadAllSpaceWorkItems(access.role) &&
      !(
        access.role === "TESTER" &&
        (await this.workItems.isTesterVisible(workItem.spaceId, workItem.id))
      ) &&
      !(await this.workItems.isParticipant(
        workItem.spaceId,
        workItem.id,
        actorUserId,
      ))
    ) {
      throwWorkItemNotFound();
    }

    return {
      access,
      workItem,
    };
  }

  private async requireSpaceAccess(userId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async validateListFilters(
    spaceId: string,
    input: Pick<
      WorkItemListInput,
      "intakeItemId" | "requirementId" | "versionId"
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
  }

  private async resolveTraceLinks(
    spaceId: string,
    input: {
      currentVersionId?: string;
      versionId?: string | null;
      requirementId?: string;
      intakeItemId?: string;
    },
  ): Promise<{
    versionId?: string | null;
    linkedUsers: WorkItemLinkedUsers[];
  }> {
    const linkedUsers: WorkItemLinkedUsers[] = [];

    let requirement: WorkItemLinkedUsers | undefined;
    let intakeItem: WorkItemLinkedUsers | undefined;

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

    const versionId = resolveTraceVersion({
      currentVersionId: input.currentVersionId,
      refs: [
        { label: "requirement", versionId: requirement?.requirementVersionId },
        { label: "intakeItem", versionId: intakeItem?.intakeVersionId },
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

  private async countVersionCascadeImpact(input: {
    workItemId: string;
    nextVersionId: string | null;
  }) {
    return this.workItems.countVersionCascadeImpact(input);
  }

  private async requireVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.workItems.findVersionInSpace(spaceId, versionId);

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
    const requirement = await this.workItems.findRequirementInSpace(
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

  private async requireIntakeItemInSpace(
    spaceId: string,
    intakeItemId: string,
  ) {
    const intakeItem = await this.workItems.findIntakeItemInSpace(
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
}

function resolveWorkItemVisibility(
  role: SpaceRole,
): WorkItemListInput["visibility"] {
  if (canReadAllSpaceWorkItems(role)) {
    return "SPACE";
  }

  if (role === "TESTER") {
    return "TESTER";
  }

  return "PARTICIPANT";
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

function selectOptional<T>(value: T | null | undefined, fallback?: T) {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? undefined : value;
}

function buildTimelineDiff(
  existing: WorkItem,
  next: {
    assigneeId?: string | null;
    description?: string | null;
    dueDate?: string | null;
    intakeItemId?: string | null;
    priority?: WorkItem["priority"];
    requirementId?: string | null;
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

function collectRelatedUserIds(linkedUsers: WorkItemLinkedUsers[]) {
  const userIds = linkedUsers.flatMap((linkedUser) => [
    linkedUser.versionOwnerId,
    linkedUser.requirementOwnerId,
    linkedUser.intakeReporterId,
    linkedUser.intakeAssigneeId,
  ]);

  return Array.from(new Set(userIds.filter(Boolean))) as string[];
}

function toCascadeAuditMetadata(impact: WorkItemVersionCascadeImpact) {
  return {
    bugCount: impact.bugCount,
    bugIds: impact.bugIds ?? [],
    relatedBugCount: impact.relatedBugCount ?? 0,
    relatedBugIds: impact.relatedBugIds ?? [],
    workItemCount: impact.workItemCount,
    workItemIds: impact.workItemIds ?? [],
  };
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwWorkItemNotFound(): never {
  throw new ApiException(
    "WORK_ITEM_NOT_FOUND",
    "Work item not found",
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
