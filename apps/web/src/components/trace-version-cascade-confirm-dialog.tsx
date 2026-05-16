"use client";

import { GitBranch, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type TraceVersionCascadeConfirmDialogProps = {
  open: boolean;
  message: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TraceVersionCascadeConfirmDialog({
  open,
  message,
  submitting = false,
  onCancel,
  onConfirm,
}: TraceVersionCascadeConfirmDialogProps) {
  const t = useTranslations("traceVersionCascadeConfirm");

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onCancel();
        }
      }}
      open={open}
    >
      <DialogContent data-testid="trace-version-cascade-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {message}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            className="text-xs"
            data-testid="trace-version-cascade-cancel"
            disabled={submitting}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("cancel")}
          </Button>
          <Button
            className="text-xs"
            data-testid="trace-version-cascade-confirm"
            disabled={submitting}
            onClick={onConfirm}
            size="sm"
            type="button"
          >
            {submitting ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <GitBranch aria-hidden="true" />
            )}
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
