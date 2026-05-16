"use client";

import type { ActionFormFieldSummary } from "@project-delivery/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { translateWorkflowFieldLabel } from "../../lib/workflow-display";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export type WorkflowFormFieldListProps = {
  fields: ActionFormFieldSummary[];
  readOnly: boolean;
  onCreate: () => void;
  onEdit: (field: ActionFormFieldSummary) => void;
  onDelete: (field: ActionFormFieldSummary) => void;
};

export function WorkflowFormFieldList({
  fields,
  readOnly,
  onCreate,
  onEdit,
  onDelete,
}: WorkflowFormFieldListProps) {
  const t = useTranslations("workflow.config.fields");
  const tType = useTranslations("workflow.fieldType");
  const tRoot = useTranslations();
  const sorted = [...fields].sort((a, b) => a.order - b.order);

  return (
    <div
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2"
    >
      <header className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">{t("title")}</h4>
        <Button
          className="h-6 text-[11px]"
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
        <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <table
          aria-label={t("title")}
          className="w-full text-[11px]"
          data-testid="workflow-form-field-table"
        >
          <thead>
            <tr className="border-b border-border/60 text-left text-muted-foreground">
              <th className="px-2 py-1 font-medium">{t("columns.key")}</th>
              <th className="px-2 py-1 font-medium">{t("columns.label")}</th>
              <th className="px-2 py-1 font-medium">
                {t("columns.fieldType")}
              </th>
              <th className="px-2 py-1 font-medium">{t("columns.required")}</th>
              <th className="px-2 py-1 font-medium">{t("columns.options")}</th>
              <th className="px-2 py-1 text-right font-medium">
                {t("columns.order")}
              </th>
              <th className="px-2 py-1 text-right font-medium">
                {t("columns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((field) => (
              <tr
                className="border-b border-border/40"
                data-testid={`workflow-form-field-row-${field.id}`}
                key={field.id}
              >
                <td className="px-2 py-1 font-mono">{field.key}</td>
                <td className="px-2 py-1">
                  {translateWorkflowFieldLabel(tRoot, field)}
                </td>
                <td className="px-2 py-1">
                  <Badge variant="outline">{tType(field.fieldType)}</Badge>
                </td>
                <td className="px-2 py-1">
                  {field.required ? (
                    <Badge variant="warning">{t("flags.required")}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {field.options && field.options.length > 0
                    ? field.options.join(", ")
                    : "-"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {field.order}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      aria-label={t("actions.edit")}
                      className="h-5 w-5"
                      disabled={readOnly}
                      onClick={() => onEdit(field)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      aria-label={t("actions.delete")}
                      className="h-5 w-5 text-destructive hover:text-destructive"
                      disabled={readOnly}
                      onClick={() => onDelete(field)}
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
      )}
    </div>
  );
}
