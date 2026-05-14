"use client";

import type {
  SpaceRole,
  WorkflowActionSummary,
  WorkflowActorRelation,
  WorkflowState,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createWorkflowAction,
  updateWorkflowAction,
  type WorkflowSpaceContext,
} from "../../lib/workflow-service";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const SPACE_ROLE_OPTIONS = [
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
] satisfies SpaceRole[];
type WorkflowActionAllowedRole = (typeof SPACE_ROLE_OPTIONS)[number];
const SPACE_ROLE_OPTION_SET = new Set<SpaceRole>(SPACE_ROLE_OPTIONS);

const ACTOR_RELATION_OPTIONS: WorkflowActorRelation[] = [
  "ASSIGNEE",
  "REPORTER",
  "CREATOR",
  "SPACE_OWNER",
];

export type WorkflowActionDialogMode =
  | { kind: "create" }
  | { kind: "edit"; action: WorkflowActionSummary };

export type WorkflowActionDialogProps = {
  context: WorkflowSpaceContext;
  workflowVersionId: string;
  states: WorkflowState[];
  mode: WorkflowActionDialogMode;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function toggle<T>(list: T[], item: T): T[] {
  if (list.includes(item)) {
    return list.filter((existing) => existing !== item);
  }
  return [...list, item];
}

export function WorkflowActionDialog({
  context,
  workflowVersionId,
  states,
  mode,
  open,
  onClose,
  onSuccess,
}: WorkflowActionDialogProps) {
  const t = useTranslations("workflow.config.actionDialog");
  const tRole = useTranslations("workflow.spaceRole");
  const tRelation = useTranslations("workflow.actorRelation");
  const tRoot = useTranslations();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [fromStateId, setFromStateId] = useState<string>("");
  const [toStateId, setToStateId] = useState<string>("");
  const [order, setOrder] = useState<string>("0");
  const [requiresComment, setRequiresComment] = useState(false);
  const [allowedRoles, setAllowedRoles] = useState<WorkflowActionAllowedRole[]>([]);
  const [actorRelations, setActorRelations] = useState<WorkflowActorRelation[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrorKey(null);
    setIsSubmitting(false);
    if (mode.kind === "edit") {
      setName(mode.action.name);
      setCode(mode.action.code);
      setFromStateId(mode.action.fromStateId);
      setToStateId(mode.action.toStateId);
      setOrder(String(mode.action.order));
      setRequiresComment(mode.action.requiresComment);
      setAllowedRoles(
        mode.action.allowedSpaceRoles.filter((role): role is WorkflowActionAllowedRole =>
          SPACE_ROLE_OPTION_SET.has(role),
        ),
      );
      setActorRelations([...mode.action.actorRelations]);
    } else {
      setName("");
      setCode("");
      setFromStateId(states[0]?.id ?? "");
      setToStateId(states[0]?.id ?? "");
      setOrder("0");
      setRequiresComment(false);
      setAllowedRoles([]);
      setActorRelations([]);
    }
  }, [mode, open, states]);

  const isEdit = mode.kind === "edit";

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorKey(null);
    try {
      const trimmedName = name.trim();
      const trimmedCode = code.trim();
      const parsedOrder = Number.parseInt(order, 10);
      const orderValue = Number.isFinite(parsedOrder) ? Math.max(0, parsedOrder) : 0;

      if (mode.kind === "edit") {
        await updateWorkflowAction(
          {
            actionId: mode.action.id,
            organizationId: context.organizationId,
            spaceId: context.spaceId,
          },
          {
            name: trimmedName,
            code: trimmedCode,
            fromStateId,
            toStateId,
            order: orderValue,
            requiresComment,
            allowedSpaceRoles: allowedRoles,
            actorRelations,
          },
        );
      } else {
        await createWorkflowAction(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
            workflowVersionId,
          },
          {
            name: trimmedName,
            code: trimmedCode,
            fromStateId,
            toStateId,
            order: orderValue,
            requiresComment,
            allowedSpaceRoles: allowedRoles,
            actorRelations,
          },
        );
      }
      onSuccess();
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    code.trim().length > 0 &&
    fromStateId.length > 0 &&
    toStateId.length > 0 &&
    !isSubmitting;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? "edit.title" : "create.title")}</DialogTitle>
          <DialogDescription>
            {t(isEdit ? "edit.description" : "create.description")}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-action-dialog-name">{t("fields.name")}</Label>
              <Input
                autoFocus
                id="workflow-action-dialog-name"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-action-dialog-code">{t("fields.code")}</Label>
              <Input
                id="workflow-action-dialog-code"
                maxLength={80}
                onChange={(event) => setCode(event.target.value)}
                pattern="[A-Za-z0-9_\\-]+"
                required
                value={code}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-action-dialog-from">
                {t("fields.fromState")}
              </Label>
              <select
                aria-label={t("fields.fromState")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                id="workflow-action-dialog-from"
                onChange={(event) => setFromStateId(event.target.value)}
                value={fromStateId}
              >
                {states.length === 0 ? (
                  <option value="">{t("fields.statePlaceholder")}</option>
                ) : null}
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-action-dialog-to">
                {t("fields.toState")}
              </Label>
              <select
                aria-label={t("fields.toState")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                id="workflow-action-dialog-to"
                onChange={(event) => setToStateId(event.target.value)}
                value={toStateId}
              >
                {states.length === 0 ? (
                  <option value="">{t("fields.statePlaceholder")}</option>
                ) : null}
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-action-dialog-order">{t("fields.order")}</Label>
            <Input
              id="workflow-action-dialog-order"
              inputMode="numeric"
              min={0}
              onChange={(event) => setOrder(event.target.value)}
              type="number"
              value={order}
            />
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              checked={requiresComment}
              onChange={(event) => setRequiresComment(event.target.checked)}
              type="checkbox"
            />
            {t("fields.requiresComment")}
          </label>

          <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-2">
            <legend className="px-1 text-[11px] font-medium text-muted-foreground">
              {t("fields.allowedRoles")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {SPACE_ROLE_OPTIONS.map((role) => (
                <label
                  key={role}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs"
                >
                  <input
                    checked={allowedRoles.includes(role)}
                    onChange={() => setAllowedRoles((prev) => toggle(prev, role))}
                    type="checkbox"
                  />
                  {tRole(role)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-2">
            <legend className="px-1 text-[11px] font-medium text-muted-foreground">
              {t("fields.actorRelations")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {ACTOR_RELATION_OPTIONS.map((relation) => (
                <label
                  key={relation}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs"
                >
                  <input
                    checked={actorRelations.includes(relation)}
                    onChange={() =>
                      setActorRelations((prev) => toggle(prev, relation))
                    }
                    type="checkbox"
                  />
                  {tRelation(relation)}
                </label>
              ))}
            </div>
          </fieldset>

          {errorKey ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {tRoot(errorKey)}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="text-xs"
              disabled={isSubmitting}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("cancel")}
            </Button>
            <Button
              className="text-xs"
              disabled={!canSubmit}
              size="sm"
              type="submit"
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
