"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { cn } from "../../lib/utils";
import type { RequestedSpaceSwitchNotice as RequestedSpaceSwitchNoticeValue } from "./use-requested-space-switch";

const AUTO_DISMISS_MS = 2000;

type RequestedSpaceSwitchNoticeProps = {
  className?: string;
  notice: RequestedSpaceSwitchNoticeValue | null;
  onDismiss: () => void;
};

export function RequestedSpaceSwitchNotice({
  className,
  notice,
  onDismiss,
}: RequestedSpaceSwitchNoticeProps) {
  const t = useTranslations("shell.requestedSpaceSwitchNotice");

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(onDismiss, AUTO_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice, onDismiss]);

  if (!notice) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-40 flex min-h-12 items-center justify-center bg-emerald-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-md md:min-h-14 md:text-base",
        className,
      )}
      role="status"
    >
      <span className="max-w-full break-words">
        {t("title", { spaceName: notice.spaceName })}
      </span>
    </div>
  );
}
