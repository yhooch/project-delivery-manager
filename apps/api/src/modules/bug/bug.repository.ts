import type { BugView } from "@project-delivery/shared";

import type {
  BugLinkedUsers,
  BugListInput,
  BugListResult,
  BugWorkflowSelection,
  CreateAuditLogInput,
  CreateBugInput,
  SpaceAuditContext,
  UpdateBugInput,
} from "./bug.types";

export const BUG_REPOSITORY = Symbol("BUG_REPOSITORY");

export type BugRepository = {
  create(input: CreateBugInput): Promise<BugView>;
  createAuditLog(input: CreateAuditLogInput): Promise<void>;
  findBugById(bugId: string): Promise<BugView | undefined>;
  findSpaceAuditContext(spaceId: string): Promise<SpaceAuditContext | undefined>;
  findVersionInSpace(
    spaceId: string,
    versionId: string,
  ): Promise<BugLinkedUsers | undefined>;
  findRequirementInSpace(
    spaceId: string,
    requirementId: string,
  ): Promise<BugLinkedUsers | undefined>;
  findIntakeItemInSpace(
    spaceId: string,
    intakeItemId: string,
  ): Promise<BugLinkedUsers | undefined>;
  findRelatedTaskInSpace(
    spaceId: string,
    relatedTaskId: string,
  ): Promise<BugLinkedUsers | undefined>;
  isParticipant(
    spaceId: string,
    bugId: string,
    userId: string,
  ): Promise<boolean>;
  listBySpaceId(spaceId: string, input: BugListInput): Promise<BugListResult>;
  resolveBugWorkflow(
    spaceId: string,
    workflowVersionId?: string,
  ): Promise<BugWorkflowSelection | undefined>;
  update(input: UpdateBugInput): Promise<BugView | undefined>;
};
