"use client";

import type {
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowDefinitionStatus,
} from "@project-delivery/shared";
import {
  Pencil,
  Plus,
  Settings2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Link, useRouter } from "../../i18n/routing";
import { canManageWorkflow as canManageWorkflowForRole } from "../../lib/permission-gates";
import {
  translateWorkflowDefinitionDescription,
  translateWorkflowDefinitionName,
} from "../../lib/workflow-display";
import {
  listWorkflowBindings,
  listWorkflows,
  listWorkflowVersions,
} from "../../lib/workflow-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import {
  formatApiErrorDisplayMessage,
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "../shell/api-error-display";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { CreateWorkflowDialog } from "./create-workflow-dialog";

const statusVariant: Record<
  WorkflowDefinitionStatus,
  "success" | "warning" | "default"
> = {
  ACTIVE: "success",
  DRAFT: "warning",
  DISABLED: "default",
};

type WorkflowCardMetadata = {
  defaultWorkItemTypes: WorkflowBinding["workItemType"][];
  targetWorkItemTypes: WorkflowBinding["workItemType"][];
  versionCount: number;
};

const emptyWorkflowCardMetadata: WorkflowCardMetadata = {
  defaultWorkItemTypes: [],
  targetWorkItemTypes: [],
  versionCount: 0,
};
const WORKFLOW_METADATA_CONCURRENCY = 4;

function collectWorkItemTypes(
  bindings: WorkflowBinding[],
  predicate: (binding: WorkflowBinding) => boolean = () => true,
) {
  return [
    ...new Set(
      bindings.filter(predicate).map((binding) => binding.workItemType),
    ),
  ].sort();
}

async function loadWorkflowCardMetadata(input: {
  organizationId?: string;
  spaceId: string;
  workflows: WorkflowDefinition[];
}): Promise<Record<string, WorkflowCardMetadata>> {
  const entries = await mapWithConcurrency(
    input.workflows,
    WORKFLOW_METADATA_CONCURRENCY,
    async (workflow) => {
      const [versionPage, bindingPage] = await Promise.all([
        listWorkflowVersions({
          organizationId: input.organizationId,
          page: 1,
          pageSize: 1,
          spaceId: input.spaceId,
          workflowId: workflow.id,
        }),
        listWorkflowBindings({
          organizationId: input.organizationId,
          page: 1,
          pageSize: 100,
          spaceId: input.spaceId,
          workflowId: workflow.id,
        }),
      ]);

      return [
        workflow.id,
        {
          defaultWorkItemTypes: collectWorkItemTypes(
            bindingPage.items,
            (binding) => binding.isDefault,
          ),
          targetWorkItemTypes: collectWorkItemTypes(bindingPage.items),
          versionCount: versionPage.total,
        },
      ] as const;
    },
  );

  return Object.fromEntries(entries);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

type WorkflowDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; workflow: WorkflowDefinition }
  | { kind: "copyVersion"; workflow: WorkflowDefinition };

export function WorkflowPage() {
  const t = useTranslations("workflow");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const tWorkItemType = useTranslations("workflow.workItemType");
  const router = useRouter();
  const { currentSpace, session, status } = useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const sessionSpace = session?.spaces?.find((space) => space.id === spaceId);
  const organizationId =
    currentSpace?.organizationId ??
    sessionSpace?.organizationId ??
    session?.defaultOrganizationId;
  const currentSpaceRole = currentSpace?.role ?? sessionSpace?.role;
  const currentSpaceStatus = currentSpace?.status ?? sessionSpace?.status;
  const canManageWorkflow = canManageWorkflowForRole(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const workflowContextKey = `${status}:${organizationId ?? ""}:${spaceId ?? ""}`;
  const workflowContextKeyRef = useRef(workflowContextKey);
  workflowContextKeyRef.current = workflowContextKey;
  const workflowRequestRef = useRef(0);

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflowMetadata, setWorkflowMetadata] = useState<
    Record<string, WorkflowCardMetadata>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);
  const [dialog, setDialog] = useState<WorkflowDialogState>({ kind: "closed" });
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    const requestId = ++workflowRequestRef.current;
    const requestContextKey = workflowContextKey;
    const isCurrentRequest = () =>
      workflowRequestRef.current === requestId &&
      workflowContextKeyRef.current === requestContextKey;

    setIsLoading(true);
    setError(null);

    try {
      const page = await listWorkflows({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
      });
      if (!isCurrentRequest()) {
        return;
      }
      const metadata = await loadWorkflowCardMetadata({
        organizationId,
        spaceId,
        workflows: page.items,
      });
      if (!isCurrentRequest()) {
        return;
      }
      setWorkflows(page.items);
      setWorkflowMetadata(metadata);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setError(
        getApiErrorDisplay(error, tRoot("errors.apiDetails.requestId")),
      );
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
      }
    }
  }, [organizationId, spaceId, tRoot, workflowContextKey]);

  useEffect(() => {
    workflowRequestRef.current += 1;
    setWorkflows([]);
    setWorkflowMetadata({});
    setIsLoading(false);
    setError(null);
    setActionErrorKey(null);
    setDialog({ kind: "closed" });
  }, [workflowContextKey]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void loadWorkflows();
  }, [loadWorkflows, spaceId, status]);

  const handleCopyAsNewVersion = useCallback((workflow: WorkflowDefinition) => {
    setActionErrorKey(null);
    setDialog({ kind: "copyVersion", workflow });
  }, []);

  const headerNode = (
    <PageHeader
      eyebrow={tShell("group.configure")}
      title={tShell("workflow")}
      description={t("page.description")}
      actions={
        <Button
          size="sm"
          className="text-xs"
          data-testid="workflow-create-button"
          onClick={() => setDialog({ kind: "create" })}
          disabled={!spaceId || !canManageWorkflow}
        >
          <Plus className="h-3 w-3" />
          {t("page.newWorkflow")}
        </Button>
      }
    />
  );

  let body;
  if (status === "loading") {
    body = <ListSkeleton rows={4} />;
  } else if (!spaceId) {
    body = (
      <EmptyState
        title={t("page.noSpace.title")}
        description={t("page.noSpace.description")}
      />
    );
  } else if (error) {
    body = (
      <ErrorState
        message={formatApiErrorDisplayMessage(
          tRoot(error.messageKey),
          error.detailLines,
        )}
        onRetry={() => void loadWorkflows()}
      />
    );
  } else if (isLoading) {
    body = <ListSkeleton rows={4} />;
  } else if (workflows.length === 0) {
    body = (
      <EmptyState
        title={t("page.empty.title")}
        description={t("page.empty.description")}
      />
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {workflows.map((wf) => {
          const metadata = workflowMetadata[wf.id] ?? emptyWorkflowCardMetadata;
          const targetTypes = metadata.targetWorkItemTypes
            .map((type) => tWorkItemType(type))
            .join(", ");
          const defaultTypes = metadata.defaultWorkItemTypes
            .map((type) => tWorkItemType(type))
            .join(", ");
          const workflowName = translateWorkflowDefinitionName(tRoot, wf);
          const workflowDescription = translateWorkflowDefinitionDescription(
            tRoot,
            wf,
          );

          return (
            <article
              key={wf.id}
              data-testid={`workflow-card-${wf.id}`}
              className={cn(
                "group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <WorkflowIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">
                      {workflowName}
                    </h3>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{wf.code}</span>
                  </div>
                </div>
                <Badge variant={statusVariant[wf.status]}>
                  {t(`definitionStatus.${wf.status}`)}
                </Badge>
              </div>

              {workflowDescription ? (
                <p className="line-clamp-2 text-[12px] text-muted-foreground">
                  {workflowDescription}
                </p>
              ) : null}

              <div
                className="flex flex-wrap items-center gap-1.5"
                data-testid={`workflow-card-summary-${wf.id}`}
              >
                <Badge variant="outline">
                  {t("config.toolbar.versionCount", {
                    count: metadata.versionCount,
                  })}
                </Badge>
                <Badge variant="outline">
                  {metadata.targetWorkItemTypes.length > 0
                    ? t("config.toolbar.targetTypes", { types: targetTypes })
                    : t("config.toolbar.noTargetTypes")}
                </Badge>
                <Badge
                  variant={
                    metadata.defaultWorkItemTypes.length > 0
                      ? "success"
                      : "outline"
                  }
                >
                  {metadata.defaultWorkItemTypes.length > 0
                    ? t("config.toolbar.defaultBindings", {
                        types: defaultTypes,
                      })
                    : t("config.toolbar.noDefaultBinding")}
                </Badge>
              </div>

              <div className="flex items-center justify-end border-t border-border pt-3">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleCopyAsNewVersion(wf)}
                    disabled={!canManageWorkflow}
                  >
                    {t("page.copyAsNewVersion")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDialog({ kind: "edit", workflow: wf })}
                    disabled={!canManageWorkflow}
                  >
                    <Pencil className="h-3 w-3" />
                    {t("page.edit")}
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    data-testid={`workflow-card-configure-${wf.id}`}
                  >
                    <Link href={`/workflow/${wf.id}`}>
                      <Settings2 className="h-3 w-3" />
                      {t("page.configure")}
                    </Link>
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div data-testid="workflow-page" className="flex h-full flex-col">
      {headerNode}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {actionErrorKey ? (
          <div
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {tRoot(actionErrorKey)}
          </div>
        ) : null}
        {body}
      </div>

      {spaceId ? (
        <CreateWorkflowDialog
          context={{ organizationId, spaceId }}
          mode={
            dialog.kind === "edit"
              ? { kind: "edit", workflow: dialog.workflow }
              : dialog.kind === "copyVersion"
                ? { kind: "copyVersion", workflow: dialog.workflow }
                : { kind: "create" }
          }
          onClose={() => setDialog({ kind: "closed" })}
          onSuccess={(workflow) => {
            const shouldEnterCreatedWorkflow = dialog.kind === "create";
            setDialog({ kind: "closed" });
            if (shouldEnterCreatedWorkflow) {
              router.push(`/workflow/${workflow.id}`);
              return;
            }
            void loadWorkflows();
          }}
          open={dialog.kind !== "closed"}
        />
      ) : null}
    </div>
  );
}
