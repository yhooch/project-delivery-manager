import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  type ConvertIntakeItemToWorkItemsRequest,
  type ConvertIntakeItemToWorkItemsResponse,
  type CreateIntakeItemRequest,
  type IntakeItem,
  type IntakeTaskInput,
  type IntakeStatus,
  type PageResult,
  type SpaceRole,
  type UpdateIntakeItemRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from "../organization/organization.repository";
import {
  REQUIREMENT_REPOSITORY,
  type RequirementRepository,
} from "../requirement/requirement.repository";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  VERSION_REPOSITORY,
  type VersionRepository,
} from "../version/version.repository";
import {
  WORK_ITEM_REPOSITORY,
  type WorkItemRepository,
} from "../workitem/workitem.repository";
import { canManageDeliveryObject } from "../workitem/delivery-object-permissions";
import {
  INTAKE_REPOSITORY,
  type IntakeRepository,
} from "./intake.repository";
import type {
  ConvertIntakeItemTaskInput,
  IntakeItemListInput,
} from "./intake.types";

const FULL_SPACE_INTAKE_READER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "VIEWER",
]);

@Injectable()
export class IntakeService {
  constructor(
    @Inject(INTAKE_REPOSITORY)
    private readonly intakeItems: IntakeRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(VERSION_REPOSITORY)
    private readonly versions: VersionRepository,
    @Inject(REQUIREMENT_REPOSITORY)
    private readonly requirements: RequirementRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizations: OrganizationRepository,
    @Inject(WORK_ITEM_REPOSITORY)
    private readonly workItems: WorkItemRepository,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    input: Omit<IntakeItemListInput, "restrictToParticipantUserId">,
  ): Promise<PageResult<IntakeItem>> {
    const access = await this.requireSpaceAccess(actorUserId, spaceId);

    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }
    if (input.requirementId) {
      await this.requireRequirementInSpace(spaceId, input.requirementId);
    }

    return this.intakeItems.listBySpaceId(spaceId, {
      ...input,
      restrictToParticipantUserId: FULL_SPACE_INTAKE_READER_ROLES.has(access.role)
        ? undefined
        : actorUserId,
    });
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateIntakeItemRequest,
  ): Promise<IntakeItem> {
    const access = await this.requireIntakeWriter(actorUserId, spaceId);

    await this.validateReferences(access.space.organizationId, spaceId, input);

    return this.intakeItems.create({
      ...input,
      id: ulid(),
      organizationId: access.space.organizationId,
      reporterId: actorUserId,
      spaceId,
    });
  }

  async get(actorUserId: string, intakeItemId: string): Promise<IntakeItem> {
    const item = await this.requireExistingIntakeItem(intakeItemId);

    await this.requireVisibleIntakeItem(actorUserId, item);

    return item;
  }

  async update(
    actorUserId: string,
    intakeItemId: string,
    input: UpdateIntakeItemRequest,
  ): Promise<IntakeItem> {
    const item = await this.requireExistingIntakeItem(intakeItemId);

    await this.requireManageableIntakeItem(actorUserId, item);
    await this.validateReferences(item.organizationId, item.spaceId, input);

    const updated = await this.intakeItems.update({
      ...input,
      intakeItemId,
      shouldUpdateAssignee: Object.prototype.hasOwnProperty.call(
        input,
        "assigneeId",
      ),
      shouldUpdateSourceObject: Object.prototype.hasOwnProperty.call(
        input,
        "sourceObject",
      ),
      updatedById: actorUserId,
    });

    return updated ?? throwIntakeItemNotFound();
  }

  async accept(actorUserId: string, intakeItemId: string): Promise<IntakeItem> {
    return this.transitionStatus(actorUserId, intakeItemId, "ACCEPTED");
  }

  async defer(actorUserId: string, intakeItemId: string): Promise<IntakeItem> {
    return this.transitionStatus(actorUserId, intakeItemId, "DEFERRED");
  }

  async reject(actorUserId: string, intakeItemId: string): Promise<IntakeItem> {
    return this.transitionStatus(actorUserId, intakeItemId, "REJECTED");
  }

  async convertToWorkItems(
    actorUserId: string,
    intakeItemId: string,
    input: ConvertIntakeItemToWorkItemsRequest,
  ): Promise<ConvertIntakeItemToWorkItemsResponse> {
    if (input.tasks.length === 0) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "At least one task is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const item = await this.requireExistingIntakeItem(intakeItemId);

    await this.requireManageableIntakeItem(actorUserId, item);
    this.assertCanConvert(item.status);

    const tasks: ConvertIntakeItemTaskInput[] = [];

    for (const task of input.tasks) {
      tasks.push(await this.prepareConvertTask(item, task));
    }

    const converted = await this.intakeItems.convertToWorkItems({
      actorUserId,
      intakeItemId,
      tasks,
    });

    if (converted) {
      return converted;
    }

    const current = await this.intakeItems.findById(intakeItemId);

    if (!current) {
      throwIntakeItemNotFound();
    }

    this.assertCanConvert(current.status);
    throwIntakeItemNotFound();
  }

  private async transitionStatus(
    actorUserId: string,
    intakeItemId: string,
    status: Extract<IntakeStatus, "ACCEPTED" | "DEFERRED" | "REJECTED">,
  ): Promise<IntakeItem> {
    const item = await this.requireExistingIntakeItem(intakeItemId);

    await this.requireManageableIntakeItem(actorUserId, item);
    this.assertCanTransition(item.status, status);

    if (item.status === status) {
      return item;
    }

    const updated = await this.intakeItems.updateStatus({
      actorUserId,
      intakeItemId,
      status,
    });

    return updated ?? throwIntakeItemNotFound();
  }

  private async validateReferences(
    organizationId: string,
    spaceId: string,
    input: {
      assigneeId?: string | null;
      requirementId?: string | null;
      versionId?: string | null;
    },
  ) {
    if (input.versionId) {
      await this.requireVersionInSpace(spaceId, input.versionId);
    }
    if (input.requirementId) {
      await this.requireRequirementInSpace(spaceId, input.requirementId);
    }
    if (input.assigneeId) {
      await this.requireActiveSpaceMember(
        organizationId,
        spaceId,
        input.assigneeId,
      );
    }
  }

  private assertCanTransition(
    from: IntakeStatus,
    to: Extract<IntakeStatus, "ACCEPTED" | "DEFERRED" | "REJECTED">,
  ) {
    if (from === "CONVERTED") {
      throw new ApiException(
        "INTAKE_ITEM_ALREADY_CONVERTED",
        "Converted intake item cannot change status",
        HttpStatus.CONFLICT,
      );
    }

    if (from === to) {
      return;
    }

    const allowed: Record<
      Extract<IntakeStatus, "ACCEPTED" | "DEFERRED" | "REJECTED">,
      IntakeStatus[]
    > = {
      ACCEPTED: ["PENDING", "DEFERRED"],
      DEFERRED: ["PENDING"],
      REJECTED: ["PENDING", "DEFERRED"],
    };

    if (!allowed[to].includes(from)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        `Cannot transition intake item from ${from} to ${to}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertCanConvert(status: IntakeStatus) {
    if (status === "CONVERTED") {
      throw new ApiException(
        "INTAKE_ITEM_ALREADY_CONVERTED",
        "Intake item has already been converted",
        HttpStatus.CONFLICT,
      );
    }

    if (status !== "ACCEPTED") {
      throw new ApiException(
        "INTAKE_ITEM_NOT_ACCEPTED",
        "Only accepted intake items can be converted",
        HttpStatus.CONFLICT,
      );
    }
  }

  private async prepareConvertTask(
    item: IntakeItem,
    task: IntakeTaskInput,
  ) {
    const versionId = task.versionId ?? item.versionId;
    const requirementId = task.requirementId ?? item.requirementId;
    const assigneeId = task.assigneeId ?? item.assigneeId;
    const version = versionId
      ? await this.requireVersionInSpace(item.spaceId, versionId)
      : undefined;
    const requirement = requirementId
      ? await this.requireRequirementInSpace(item.spaceId, requirementId)
      : undefined;

    if (assigneeId) {
      await this.requireActiveSpaceMember(
        item.organizationId,
        item.spaceId,
        assigneeId,
      );
    }

    const workflow = await this.workItems.resolveTaskWorkflow(
      item.spaceId,
      task.workflowVersionId,
    );

    if (!workflow) {
      if (task.workflowVersionId) {
        throwWorkflowVersionNotFound();
      }

      throw new ApiException(
        "VALIDATION_ERROR",
        "Default TASK workflow binding is not configured",
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      id: ulid(),
      assigneeId,
      currentStateId: workflow.currentStateId,
      description: task.description ?? item.description,
      dueDate: parseOptionalDate(task.dueDate, "dueDate"),
      priority: task.priority ?? item.priority ?? "MEDIUM",
      relatedUserIds: collectRelatedUserIds([
        version?.ownerId,
        requirement?.ownerId,
        item.reporterId,
        item.assigneeId,
      ]),
      reporterId: item.reporterId,
      requirementId,
      statusCategory: workflow.statusCategory,
      title: task.title ?? item.title,
      versionId,
      workflowVersionId: workflow.workflowVersionId,
    };
  }

  private async requireExistingIntakeItem(
    intakeItemId: string,
  ): Promise<IntakeItem> {
    const item = await this.intakeItems.findById(intakeItemId);

    if (!item) {
      throwIntakeItemNotFound();
    }

    return item;
  }

  private async requireVisibleIntakeItem(
    actorUserId: string,
    item: IntakeItem,
  ) {
    const access = await this.requireSpaceAccess(actorUserId, item.spaceId);

    if (FULL_SPACE_INTAKE_READER_ROLES.has(access.role)) {
      return access;
    }

    const isParticipant = await this.intakeItems.hasParticipant({
      intakeItemId: item.id,
      spaceId: item.spaceId,
      userId: actorUserId,
    });

    if (!isParticipant) {
      throwIntakeItemNotFound();
    }

    return access;
  }

  private async requireManageableIntakeItem(
    actorUserId: string,
    item: IntakeItem,
  ) {
    const access = await this.requireVisibleIntakeItem(actorUserId, item);

    if (!canManageDeliveryObject(access.role)) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireSpaceAccess(userId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(userId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireIntakeWriter(userId: string, spaceId: string) {
    const access = await this.requireSpaceAccess(userId, spaceId);

    if (access.role === "VIEWER") {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.versions.findById(versionId);

    if (!version || version.spaceId !== spaceId) {
      throw new ApiException("NOT_FOUND", "Version not found", HttpStatus.NOT_FOUND);
    }

    return version;
  }

  private async requireRequirementInSpace(spaceId: string, requirementId: string) {
    const requirement = await this.requirements.findById(requirementId);

    if (!requirement || requirement.spaceId !== spaceId) {
      throw new ApiException(
        "REQUIREMENT_NOT_FOUND",
        "Requirement not found",
        HttpStatus.NOT_FOUND,
      );
    }

    return requirement;
  }

  private async requireActiveSpaceMember(
    organizationId: string,
    spaceId: string,
    userId: string,
  ) {
    const organizationMember = await this.organizations.findMemberByUserId(
      organizationId,
      userId,
    );

    if (!organizationMember || organizationMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_MUST_BELONG_TO_ORGANIZATION",
        "Assignee must belong to the same organization",
        HttpStatus.BAD_REQUEST,
      );
    }

    const spaceMember = await this.spaces.findMemberByUserId(spaceId, userId);

    if (!spaceMember || spaceMember.status !== "ACTIVE") {
      throw new ApiException(
        "SPACE_MEMBER_NOT_FOUND",
        "Assignee must be an active space member",
        HttpStatus.NOT_FOUND,
      );
    }

    return spaceMember;
  }
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwIntakeItemNotFound(): never {
  throw new ApiException(
    "INTAKE_ITEM_NOT_FOUND",
    "Intake item not found",
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

function collectRelatedUserIds(userIds: Array<string | undefined>) {
  return Array.from(new Set(userIds.filter(Boolean))) as string[];
}
