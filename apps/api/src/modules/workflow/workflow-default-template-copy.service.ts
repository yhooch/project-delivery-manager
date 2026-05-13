import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import {
  Prisma,
  type ActionFormField,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowState,
  type WorkflowVersion,
} from "../../generated/prisma/client";
import type {
  DefaultWorkflowActionFormFieldTemplate,
  DefaultWorkflowActionTemplate,
  DefaultWorkflowStateTemplate,
  DefaultWorkflowTemplate,
} from "./default-workflow.templates";
import { WorkflowVersionPublisherService } from "./workflow-version-publisher.service";

export type CopyDefaultWorkflowInput = {
  readonly organizationId: string;
  readonly spaceId: string;
  readonly actorUserId: string;
  readonly publishedAt: Date;
  readonly template: DefaultWorkflowTemplate;
};

export type CopiedDefaultWorkflow = {
  readonly definition: WorkflowDefinition;
  readonly version: WorkflowVersion;
  readonly states: readonly WorkflowState[];
  readonly actions: readonly WorkflowAction[];
};

@Injectable()
export class WorkflowDefaultTemplateCopyService {
  constructor(
    @Inject(WorkflowVersionPublisherService)
    private readonly publisher: WorkflowVersionPublisherService,
  ) {}

  async copyTemplateToSpace(
    tx: Prisma.TransactionClient,
    input: CopyDefaultWorkflowInput,
  ): Promise<CopiedDefaultWorkflow> {
    const definition = await this.ensureDefinition(tx, input);
    const draftOrPublishedVersion = await this.ensureVersion(
      tx,
      definition.id,
      input,
    );
    const states = await this.ensureStates(tx, draftOrPublishedVersion.id, input);
    const actions = await this.ensureActions(
      tx,
      draftOrPublishedVersion.id,
      states,
      input,
    );
    const version = await this.publisher.publishVersion(tx, {
      actorUserId: input.actorUserId,
      publishedAt: input.publishedAt,
      version: draftOrPublishedVersion,
    });

    return {
      actions,
      definition,
      states,
      version,
    };
  }

  private async ensureDefinition(
    tx: Prisma.TransactionClient,
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowDefinition> {
    const existing = await tx.workflowDefinition.findFirst({
      where: {
        code: input.template.code,
        deletedAt: null,
        spaceId: input.spaceId,
      },
    });

    if (!existing) {
      return tx.workflowDefinition.create({
        data: {
          id: ulid(),
          code: input.template.code,
          createdById: input.actorUserId,
          description: input.template.description,
          name: input.template.name,
          organizationId: input.organizationId,
          spaceId: input.spaceId,
          status: "ACTIVE",
          updatedById: input.actorUserId,
        },
      });
    }

    if (
      existing.name === input.template.name &&
      existing.description === input.template.description &&
      existing.status === "ACTIVE" &&
      existing.organizationId === input.organizationId
    ) {
      return existing;
    }

    return tx.workflowDefinition.update({
      data: {
        description: input.template.description,
        name: input.template.name,
        organizationId: input.organizationId,
        status: "ACTIVE",
        updatedById: input.actorUserId,
      },
      where: {
        id: existing.id,
      },
    });
  }

  private async ensureVersion(
    tx: Prisma.TransactionClient,
    workflowDefinitionId: string,
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowVersion> {
    const existing = await tx.workflowVersion.findFirst({
      where: {
        deletedAt: null,
        version: input.template.version,
        workflowDefinitionId,
      },
    });

    if (existing) {
      return existing;
    }

    return tx.workflowVersion.create({
      data: {
        id: ulid(),
        createdById: input.actorUserId,
        status: "DRAFT",
        updatedById: input.actorUserId,
        version: input.template.version,
        workflowDefinitionId,
      },
    });
  }

  private async ensureStates(
    tx: Prisma.TransactionClient,
    workflowVersionId: string,
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowState[]> {
    const startState = input.template.states.find((state) => state.isStart);

    if (startState) {
      await tx.workflowState.updateMany({
        data: {
          isStart: false,
          updatedById: input.actorUserId,
        },
        where: {
          code: {
            not: startState.code,
          },
          deletedAt: null,
          isStart: true,
          workflowVersionId,
        },
      });
    }

    const states: WorkflowState[] = [];

    for (const [index, state] of input.template.states.entries()) {
      states.push(
        await this.ensureState(tx, workflowVersionId, state, index, input),
      );
    }

    return states;
  }

  private async ensureState(
    tx: Prisma.TransactionClient,
    workflowVersionId: string,
    state: DefaultWorkflowStateTemplate,
    index: number,
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowState> {
    const existing = await tx.workflowState.findFirst({
      where: {
        code: state.code,
        deletedAt: null,
        workflowVersionId,
      },
    });
    const data = {
      category: state.category,
      isEnd: state.isEnd ?? false,
      isStart: state.isStart ?? false,
      name: state.name,
      sortOrder: index,
    };

    if (!existing) {
      return tx.workflowState.create({
        data: {
          ...data,
          id: ulid(),
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          workflowVersionId,
          code: state.code,
        },
      });
    }

    if (
      existing.category === data.category &&
      existing.isEnd === data.isEnd &&
      existing.isStart === data.isStart &&
      existing.name === data.name &&
      existing.sortOrder === data.sortOrder
    ) {
      return existing;
    }

    return tx.workflowState.update({
      data: {
        ...data,
        updatedById: input.actorUserId,
      },
      where: {
        id: existing.id,
      },
    });
  }

  private async ensureActions(
    tx: Prisma.TransactionClient,
    workflowVersionId: string,
    states: readonly WorkflowState[],
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowAction[]> {
    const stateByCode = new Map(states.map((state) => [state.code, state]));
    const actions: WorkflowAction[] = [];

    for (const [index, action] of input.template.actions.entries()) {
      const fromState = stateByCode.get(action.fromStateCode);
      const toState = stateByCode.get(action.toStateCode);

      if (!fromState || !toState) {
        throw new Error(
          `Default workflow ${input.template.code} action ${action.code} references an unknown state`,
        );
      }

      const savedAction = await this.ensureAction(
        tx,
        workflowVersionId,
        fromState.id,
        toState.id,
        action,
        index,
        input,
      );
      await this.ensureFormFields(tx, savedAction.id, action, input);
      actions.push(savedAction);
    }

    return actions;
  }

  private async ensureAction(
    tx: Prisma.TransactionClient,
    workflowVersionId: string,
    fromStateId: string,
    toStateId: string,
    action: DefaultWorkflowActionTemplate,
    index: number,
    input: CopyDefaultWorkflowInput,
  ): Promise<WorkflowAction> {
    const existing = await tx.workflowAction.findFirst({
      where: {
        code: action.code,
        deletedAt: null,
        workflowVersionId,
      },
    });
    const data = {
      actorRelations: [...action.actorRelations],
      allowedSpaceRoles: [...action.allowedSpaceRoles],
      fromStateId,
      name: action.name,
      requiresComment: action.requiresComment ?? false,
      sortOrder: index,
      toStateId,
    };

    if (!existing) {
      return tx.workflowAction.create({
        data: {
          ...data,
          id: ulid(),
          code: action.code,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          workflowVersionId,
        },
      });
    }

    if (
      existing.fromStateId === data.fromStateId &&
      existing.toStateId === data.toStateId &&
      existing.name === data.name &&
      existing.requiresComment === data.requiresComment &&
      existing.sortOrder === data.sortOrder &&
      stringArraysEqual(existing.allowedSpaceRoles, data.allowedSpaceRoles) &&
      stringArraysEqual(existing.actorRelations, data.actorRelations)
    ) {
      return existing;
    }

    return tx.workflowAction.update({
      data: {
        ...data,
        updatedById: input.actorUserId,
      },
      where: {
        id: existing.id,
      },
    });
  }

  private async ensureFormFields(
    tx: Prisma.TransactionClient,
    actionId: string,
    action: DefaultWorkflowActionTemplate,
    input: CopyDefaultWorkflowInput,
  ): Promise<ActionFormField[]> {
    const fields: ActionFormField[] = [];

    for (const [index, field] of (action.formFields ?? []).entries()) {
      fields.push(await this.ensureFormField(tx, actionId, field, index, input));
    }

    return fields;
  }

  private async ensureFormField(
    tx: Prisma.TransactionClient,
    actionId: string,
    field: DefaultWorkflowActionFormFieldTemplate,
    index: number,
    input: CopyDefaultWorkflowInput,
  ): Promise<ActionFormField> {
    const existing = await tx.actionFormField.findFirst({
      where: {
        actionId,
        deletedAt: null,
        key: field.key,
      },
    });
    const data = {
      fieldType: field.fieldType,
      label: field.label,
      options: [...(field.options ?? [])],
      required: field.required,
      sortOrder: index,
    };

    if (!existing) {
      return tx.actionFormField.create({
        data: {
          ...data,
          id: ulid(),
          actionId,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          key: field.key,
        },
      });
    }

    if (
      existing.fieldType === data.fieldType &&
      existing.label === data.label &&
      existing.required === data.required &&
      existing.sortOrder === data.sortOrder &&
      stringArraysEqual(existing.options, data.options)
    ) {
      return existing;
    }

    return tx.actionFormField.update({
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

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
