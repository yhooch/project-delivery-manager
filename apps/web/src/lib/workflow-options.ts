import type {
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowVersion,
  WorkItemType,
} from "@project-delivery/shared";

import {
  listWorkflowBindings,
  listWorkflowVersions,
  listWorkflows,
  type WorkflowSpaceContext,
} from "./workflow-service";
import { translateWorkflowDefinitionName } from "./workflow-display";

export type WorkflowVersionOption = {
  binding: WorkflowBinding;
  isDefault: boolean;
  version: WorkflowVersion;
  workflow: WorkflowDefinition;
};

export async function loadWorkflowVersionOptions(
  context: WorkflowSpaceContext,
  workItemType: WorkItemType,
): Promise<WorkflowVersionOption[]> {
  const [workflowPage, bindingPage] = await Promise.all([
    listWorkflows({ ...context, page: 1, pageSize: 100 }),
    listWorkflowBindings({
      ...context,
      page: 1,
      pageSize: 100,
      workItemType,
    }),
  ]);

  const workflowsById = new Map(
    workflowPage.items.map((workflow) => [workflow.id, workflow]),
  );
  const bindings = bindingPage.items.filter((binding) => {
    const workflow = workflowsById.get(binding.workflowId);

    return (
      binding.workItemType === workItemType && workflow?.status === "ACTIVE"
    );
  });
  const workflowIds = Array.from(
    new Set(bindings.map((binding) => binding.workflowId)),
  );
  const versionPages = await Promise.all(
    workflowIds.map((workflowId) =>
      listWorkflowVersions({
        ...context,
        page: 1,
        pageSize: 100,
        workflowId,
      }),
    ),
  );
  const versionsByWorkflowId = new Map<string, WorkflowVersion[]>();
  for (const version of versionPages.flatMap((page) => page.items)) {
    const versions = versionsByWorkflowId.get(version.workflowId) ?? [];
    versions.push(version);
    versionsByWorkflowId.set(version.workflowId, versions);
  }
  const bindingsByWorkflowId = new Map<string, WorkflowBinding[]>();
  for (const binding of bindings) {
    const workflowBindings = bindingsByWorkflowId.get(binding.workflowId) ?? [];
    workflowBindings.push(binding);
    bindingsByWorkflowId.set(binding.workflowId, workflowBindings);
  }

  return workflowIds
    .flatMap((workflowId) => {
      const workflow = workflowsById.get(workflowId);
      const workflowBindings = bindingsByWorkflowId.get(workflowId) ?? [];

      if (!workflow || workflowBindings.length === 0) {
        return [];
      }

      return (versionsByWorkflowId.get(workflowId) ?? [])
        .filter((version) => version.status === "PUBLISHED")
        .flatMap((version) => {
          const matchingBindings = workflowBindings.filter(
            (binding) => binding.workflowVersionId === version.id,
          );
          const binding =
            matchingBindings.find((candidate) => candidate.isDefault) ??
            matchingBindings[0];

          if (!binding) {
            return [];
          }

          return [
            {
              binding,
              isDefault: binding.isDefault,
              version,
              workflow,
            },
          ];
        });
    })
    .sort(compareWorkflowVersionOptions);
}

export function getDefaultWorkflowVersionId(
  options: WorkflowVersionOption[],
): string {
  return options.find((option) => option.isDefault)?.version.id ?? "";
}

export function formatWorkflowVersionOption(
  option: WorkflowVersionOption,
  t: (key: string) => string,
): string {
  const workflowName = translateWorkflowDefinitionName(t, option.workflow);
  const defaultMark = option.isDefault
    ? ` · ${t("workflow.bindingsPanel.fields.isDefault")}`
    : "";

  return `${workflowName} v${option.version.version}${defaultMark}`;
}

function compareWorkflowVersionOptions(
  left: WorkflowVersionOption,
  right: WorkflowVersionOption,
): number {
  if (left.isDefault !== right.isDefault) {
    return left.isDefault ? -1 : 1;
  }

  const nameCompare = left.workflow.name.localeCompare(right.workflow.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return right.version.version - left.version.version;
}
