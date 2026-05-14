"use client";

import type {
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
import { useCallback, useEffect, useState } from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listWorkflows } from "../../lib/workflow-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";

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

type WorkflowDialogState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; workflow: WorkflowDefinition }
  | { kind: "copyVersion"; workflow: WorkflowDefinition };

export function WorkflowPage() {
  const t = useTranslations("workflow");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const { currentSpace, session, status } = useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<WorkflowDialogState>({ kind: "closed" });
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listWorkflows({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
      });
      setWorkflows(page.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, spaceId]);

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
          disabled={!spaceId}
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
  } else if (errorKey) {
    body = (
      <ErrorState
        message={tRoot(errorKey)}
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
        {workflows.map((wf) => (
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
                  <h3 className="truncate text-sm font-semibold">{wf.name}</h3>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span>{wf.code}</span>
                </div>
              </div>
              <Badge variant={statusVariant[wf.status]}>
                {t(`definitionStatus.${wf.status}`)}
              </Badge>
            </div>

            {wf.description ? (
              <p className="line-clamp-2 text-[12px] text-muted-foreground">
                {wf.description}
              </p>
            ) : null}

            <div className="flex items-center justify-end border-t border-border pt-3">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleCopyAsNewVersion(wf)}
                >
                  {t("page.copyAsNewVersion")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setDialog({ kind: "edit", workflow: wf })}
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
        ))}
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
          onSuccess={() => {
            setDialog({ kind: "closed" });
            void loadWorkflows();
          }}
          open={dialog.kind !== "closed"}
        />
      ) : null}
    </div>
  );
}
