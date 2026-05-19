"use client";

import type {
  ActionFormFieldSummary,
  WorkflowActionConfigSummary,
  WorkflowState,
} from "@project-delivery/shared";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  translateWorkflowActionName,
  translateWorkflowStateName,
} from "../../lib/workflow-display";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

import { WorkflowFormFieldList } from "./workflow-form-field-list";

export type WorkflowActionListProps = {
  actions: WorkflowActionConfigSummary[];
  states: WorkflowState[];
  readOnly: boolean;
  onCreate: () => void;
  onEdit: (action: WorkflowActionConfigSummary) => void;
  onDelete: (action: WorkflowActionConfigSummary) => void;
  onCreateField: (action: WorkflowActionConfigSummary) => void;
  onEditField: (
    action: WorkflowActionConfigSummary,
    field: ActionFormFieldSummary,
  ) => void;
  onDeleteField: (
    action: WorkflowActionConfigSummary,
    field: ActionFormFieldSummary,
  ) => void;
};

export function WorkflowActionList({
  actions,
  states,
  readOnly,
  onCreate,
  onEdit,
  onDelete,
  onCreateField,
  onEditField,
  onDeleteField,
}: WorkflowActionListProps) {
  const t = useTranslations("workflow.config.actions");
  const tRole = useTranslations("workflow.spaceRole");
  const tRoot = useTranslations();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const stateNameById = new Map(
    states.map((state) => [state.id, translateWorkflowStateName(tRoot, state)]),
  );
  const sorted = [...actions].sort((a, b) => a.order - b.order);

  function toggleExpand(actionId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  }

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button
          className="h-7 text-xs"
          disabled={readOnly}
          onClick={onCreate}
          size="sm"
          variant="outline"
        >
          <Plus className="h-3 w-3" />
          {t("create")}
        </Button>
      </header>

      {sorted.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul
          aria-label={t("title")}
          className="flex flex-col gap-2"
          data-testid="workflow-action-list"
        >
          {sorted.map((action) => {
            const isOpen = expanded.has(action.id);
            const fromName =
              stateNameById.get(action.fromStateId) ?? action.fromStateId;
            const toName =
              stateNameById.get(action.toStateId) ?? action.toStateId;
            const allowedRoleNames = action.allowedSpaceRoles
              .map((role) => tRole(role))
              .join(t("flags.roleSeparator"));
            return (
              <li
                className="rounded-md border border-border/70 bg-background"
                data-testid={`workflow-action-row-${action.id}`}
                key={action.id}
              >
                <div className="flex items-center gap-2 px-2 py-2">
                  <Button
                    aria-expanded={isOpen}
                    aria-label={t("actions.toggleFields")}
                    className="h-6 w-6"
                    onClick={() => toggleExpand(action.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">
                        {translateWorkflowActionName(tRoot, action)}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {action.code}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span>
                        {t("transition", { from: fromName, to: toName })}
                      </span>
                      {action.requiresComment ? (
                        <Badge variant="warning">
                          {t("flags.requiresComment")}
                        </Badge>
                      ) : null}
                      {action.allowedSpaceRoles.length > 0 ? (
                        <Badge title={allowedRoleNames} variant="outline">
                          {t("flags.rolesLabel")}
                          {allowedRoleNames}
                        </Badge>
                      ) : null}
                      <span className="ml-auto tabular-nums">
                        {t("flags.order", { order: action.order })}
                      </span>
                    </div>
                  </div>
                  <div className="inline-flex gap-1">
                    <Button
                      aria-label={t("actions.edit")}
                      className="h-6 w-6"
                      disabled={readOnly}
                      onClick={() => onEdit(action)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      aria-label={t("actions.delete")}
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      disabled={readOnly}
                      onClick={() => onDelete(action)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {isOpen ? (
                  <div className="border-t border-border/60 p-2">
                    <WorkflowFormFieldList
                      fields={action.formFields}
                      onCreate={() => onCreateField(action)}
                      onDelete={(field) => onDeleteField(action, field)}
                      onEdit={(field) => onEditField(action, field)}
                      readOnly={readOnly}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
