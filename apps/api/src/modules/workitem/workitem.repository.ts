import type { WorkItem } from "@project-delivery/shared";

import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
  WorkItemLinkedUsers,
  WorkItemListInput,
  WorkItemListResult,
  WorkItemWorkflowSelection,
} from "./workitem.types";

export const WORK_ITEM_REPOSITORY = Symbol("WORK_ITEM_REPOSITORY");

export type WorkItemRepository = {
  create(input: CreateWorkItemInput): Promise<WorkItem>;
  findTaskById(workItemId: string): Promise<WorkItem | undefined>;
  findVersionInSpace(
    spaceId: string,
    versionId: string,
  ): Promise<WorkItemLinkedUsers | undefined>;
  findRequirementInSpace(
    spaceId: string,
    requirementId: string,
  ): Promise<WorkItemLinkedUsers | undefined>;
  findIntakeItemInSpace(
    spaceId: string,
    intakeItemId: string,
  ): Promise<WorkItemLinkedUsers | undefined>;
  isParticipant(
    spaceId: string,
    workItemId: string,
    userId: string,
  ): Promise<boolean>;
  listBySpaceId(
    spaceId: string,
    input: WorkItemListInput,
  ): Promise<WorkItemListResult>;
  resolveTaskWorkflow(
    spaceId: string,
    workflowVersionId?: string,
  ): Promise<WorkItemWorkflowSelection | undefined>;
  update(input: UpdateWorkItemInput): Promise<WorkItem | undefined>;
};
