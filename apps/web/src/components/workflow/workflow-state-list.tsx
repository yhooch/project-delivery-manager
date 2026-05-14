"use client";

import type { WorkflowState } from "@project-delivery/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export type WorkflowStateListProps = {
  states: WorkflowState[];
  readOnly: boolean;
  onCreate: () => void;
  onEdit: (state: WorkflowState) => void;
  onDelete: (state: WorkflowState) => void;
};

export function WorkflowStateList({
  states,
  readOnly,
  onCreate,
  onEdit,
  onDelete,
}: WorkflowStateListProps) {
  const t = useTranslations("workflow.config.states");
  const tCategory = useTranslations("workflow.statusCategory");

  const sorted = [...states].sort((a, b) => a.order - b.order);

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="text-[11px] text-muted-foreground">{t("description")}</p>
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
        <div className="overflow-x-auto">
          <table
            aria-label={t("title")}
            className="w-full text-xs"
            data-testid="workflow-state-table"
          >
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t("columns.code")}</th>
                <th className="px-2 py-1.5 font-medium">{t("columns.name")}</th>
                <th className="px-2 py-1.5 font-medium">{t("columns.category")}</th>
                <th className="px-2 py-1.5 font-medium">{t("columns.flags")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("columns.order")}</th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((state) => (
                <tr
                  className="border-b border-border/60"
                  data-testid={`workflow-state-row-${state.id}`}
                  key={state.id}
                >
                  <td className="px-2 py-1.5 font-mono text-[11px]">{state.code}</td>
                  <td className="px-2 py-1.5">{state.name}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline">{tCategory(state.category)}</Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {state.isStart ? (
                        <Badge variant="primary">{t("flags.isStart")}</Badge>
                      ) : null}
                      {state.isEnd ? (
                        <Badge variant="success">{t("flags.isEnd")}</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {state.order}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        aria-label={t("actions.edit")}
                        className="h-6 w-6"
                        disabled={readOnly}
                        onClick={() => onEdit(state)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        aria-label={t("actions.delete")}
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        disabled={readOnly}
                        onClick={() => onDelete(state)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
