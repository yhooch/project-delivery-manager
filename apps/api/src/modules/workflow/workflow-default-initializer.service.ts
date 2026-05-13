import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { DefaultWorkflowSummary } from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DEFAULT_WORKFLOW_TEMPLATES } from "./default-workflow.templates";
import { WorkflowDefaultBindingService } from "./workflow-default-binding.service";
import { WorkflowDefaultTemplateCopyService } from "./workflow-default-template-copy.service";

export type InitializeDefaultWorkflowsForSpaceInput = {
  readonly organizationId: string;
  readonly spaceId: string;
  readonly actorUserId: string;
};

@Injectable()
export class WorkflowDefaultInitializerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(WorkflowDefaultTemplateCopyService)
    private readonly copier: WorkflowDefaultTemplateCopyService,
    @Inject(WorkflowDefaultBindingService)
    private readonly bindings: WorkflowDefaultBindingService,
  ) {}

  async initializeDefaultWorkflowsForSpace(
    input: InitializeDefaultWorkflowsForSpaceInput,
  ): Promise<DefaultWorkflowSummary[]> {
    const publishedAt = new Date();

    return this.prisma.client.$transaction((tx) =>
      this.initializeDefaultWorkflowsForSpaceInTransaction(
        tx,
        input,
        publishedAt,
      ),
    );
  }

  async initializeDefaultWorkflowsForSpaceInTransaction(
    tx: Prisma.TransactionClient,
    input: InitializeDefaultWorkflowsForSpaceInput,
    publishedAt = new Date(),
  ): Promise<DefaultWorkflowSummary[]> {
    const space = await tx.space.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: input.spaceId,
        organizationId: input.organizationId,
      },
    });

    if (!space) {
      throw new ApiException(
        "SPACE_NOT_FOUND",
        "Space not found",
        HttpStatus.NOT_FOUND,
      );
    }

    const summaries: DefaultWorkflowSummary[] = [];

    for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
      const copied = await this.copier.copyTemplateToSpace(tx, {
        ...input,
        publishedAt,
        template,
      });
      const binding = await this.bindings.ensureBinding(tx, {
        ...input,
        template,
        workflowDefinitionId: copied.definition.id,
        workflowVersionId: copied.version.id,
      });

      summaries.push({
        actionCount: copied.actions.length,
        code: template.code,
        isDefault: binding.isDefault,
        name: copied.definition.name,
        publishedAt: copied.version.publishedAt?.toISOString(),
        stateCount: copied.states.length,
        version: copied.version.version,
        workflowId: copied.definition.id,
        workflowVersionId: copied.version.id,
        workItemType: template.binding.workItemType,
      });
    }

    return summaries;
  }
}
