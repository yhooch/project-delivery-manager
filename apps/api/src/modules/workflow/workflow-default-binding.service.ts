import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import {
  Prisma,
  type WorkflowBinding,
} from "../../generated/prisma/client";
import type { DefaultWorkflowTemplate } from "./default-workflow.templates";

export type EnsureDefaultWorkflowBindingInput = {
  readonly organizationId: string;
  readonly spaceId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersionId: string;
  readonly actorUserId: string;
  readonly template: DefaultWorkflowTemplate;
};

@Injectable()
export class WorkflowDefaultBindingService {
  async ensureBinding(
    tx: Prisma.TransactionClient,
    input: EnsureDefaultWorkflowBindingInput,
  ): Promise<WorkflowBinding> {
    const existing = await tx.workflowBinding.findFirst({
      where: {
        deletedAt: null,
        spaceId: input.spaceId,
        targetType: "WORK_ITEM",
        workItemType: input.template.binding.workItemType,
        workflowDefinitionId: input.workflowDefinitionId,
      },
    });
    const data = {
      isDefault: input.template.binding.isDefault,
      organizationId: input.organizationId,
      priority: null,
      spaceId: input.spaceId,
      targetType: "WORK_ITEM" as const,
      workItemType: input.template.binding.workItemType,
      workflowDefinitionId: input.workflowDefinitionId,
      workflowVersionId: input.workflowVersionId,
    };

    if (!existing) {
      return tx.workflowBinding.create({
        data: {
          ...data,
          id: ulid(),
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });
    }

    if (
      existing.isDefault === data.isDefault &&
      existing.organizationId === data.organizationId &&
      existing.priority === data.priority &&
      existing.spaceId === data.spaceId &&
      existing.targetType === data.targetType &&
      existing.workItemType === data.workItemType &&
      existing.workflowDefinitionId === data.workflowDefinitionId &&
      existing.workflowVersionId === data.workflowVersionId
    ) {
      return existing;
    }

    return tx.workflowBinding.update({
      data: {
        ...data,
        updatedById: input.actorUserId,
      },
      where: {
        id: existing.id,
      },
    });
  }
}

