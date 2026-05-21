"use client";

import type {
  TimelineEvent,
  TimelineEventType,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import {
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type Ref,
} from "react";

import { Link } from "../../i18n/routing";
import {
  formatTimelineEvent,
  type TimelineMessageTranslator,
} from "../../lib/timeline-display";
import { cn } from "../../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

type TimelineEventItemProps = {
  className?: string;
  contextLabel?: string;
  density?: "compact" | "full";
  event: TimelineEvent;
  href?: string | null;
  justNowLabel?: string;
  locale: string;
  testId?: string;
  timeStyle?: "absolute" | "relative";
  translateEventType: (key: TimelineEventType) => string;
  unknownActorLabel?: string;
};

export function TimelineEventItem({
  className,
  contextLabel,
  density = "full",
  event,
  href,
  justNowLabel = "",
  locale,
  testId,
  timeStyle = "absolute",
  translateEventType,
  unknownActorLabel,
}: TimelineEventItemProps) {
  const translateMessage = useTranslations() as TimelineMessageTranslator;
  const display = formatTimelineEvent(event, {
    href,
    translateMessage,
    translateEventType,
    unknownActorLabel,
  });
  const compact = density === "compact";
  const actorName = display.actor.name || unknownActorLabel || "?";
  const timestamp =
    timeStyle === "relative"
      ? formatTimeAgo(display.time, locale, justNowLabel)
      : formatDateTime(display.time, locale);
  const primaryText = uniqueStrings([
    actorName,
    display.actionLabel,
    display.summary,
    display.targetTitle && display.targetTitle !== display.summary
      ? display.targetTitle
      : undefined,
  ]).join(" ");
  const primaryLine = (
    <div
      className={cn(
        "min-w-0 leading-snug",
        compact ? "truncate" : "flex flex-wrap items-baseline gap-x-1.5",
      )}
    >
      <span className="font-medium text-foreground/90">{actorName}</span>
      <span className="text-muted-foreground">{display.actionLabel}</span>
      {display.summary ? (
        <span className="min-w-0 font-medium text-foreground">
          {display.summary}
        </span>
      ) : null}
      {display.targetTitle && display.targetTitle !== display.summary ? (
        compact ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {display.targetTitle}
          </span>
        ) : (
          <OverflowTip content={display.targetTitle}>
            <span className="min-w-0 truncate text-muted-foreground">
              {display.targetTitle}
            </span>
          </OverflowTip>
        )
      ) : null}
    </div>
  );
  const content = (
    <div className={cn("flex min-w-0 gap-3", compact ? "items-start" : "")}>
      <Tip content={actorName}>
        <Avatar
          className={cn(
            "z-10 shrink-0 bg-muted",
            compact
              ? "h-6 w-6 border-4 border-background"
              : "h-7 w-7 border border-border",
          )}
        >
          {display.actor.avatar ? (
            <AvatarImage src={display.actor.avatar} alt={actorName} />
          ) : null}
          <AvatarFallback
            className={cn(
              "bg-transparent text-muted-foreground",
              compact ? "text-[9px]" : "text-[10px]",
            )}
          >
            {display.actor.initial}
          </AvatarFallback>
        </Avatar>
      </Tip>
      <div className="min-w-0 flex-1 text-[13px]">
        {compact && primaryText ? (
          <OverflowTip content={primaryText}>{primaryLine}</OverflowTip>
        ) : (
          primaryLine
        )}
        {display.detail ? (
          compact ? (
            <OverflowTip content={display.detail}>
              <div className="mt-0.5 min-w-0 truncate text-xs text-muted-foreground">
                {display.detail}
              </div>
            </OverflowTip>
          ) : (
            <div className="mt-0.5 min-w-0 break-words text-xs text-muted-foreground">
              {display.detail}
            </div>
          )
        ) : null}
        {!compact && display.secondary ? (
          <div className="mt-0.5 min-w-0 break-words text-[11px] text-muted-foreground">
            {display.secondary}
          </div>
        ) : null}
        {!compact && display.changes.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
            {display.changes.slice(0, 4).map((change) => {
              const changeText = `${change.field} ${change.before ?? "-"} -> ${
                change.after ?? "-"
              }`;

              return (
                <OverflowTip key={change.field} content={changeText}>
                  <li className="min-w-0 truncate">
                    <span className="font-medium text-foreground/80">
                      {change.field}
                    </span>
                    <span> {change.before ?? "-"} -&gt; </span>
                    <span>{change.after ?? "-"}</span>
                  </li>
                </OverflowTip>
              );
            })}
          </ul>
        ) : null}
        <div
          className={cn(
            "mt-1 text-[11px] font-medium text-muted-foreground/70",
            compact ? "truncate" : "",
          )}
        >
          {contextLabel ? `${timestamp} · ${contextLabel}` : timestamp}
        </div>
      </div>
    </div>
  );

  return (
    <li data-testid={testId} className={className}>
      {display.href ? (
        <Link
          href={display.href as never}
          className="block -mx-2 -my-2 rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </li>
  );
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTimeAgo(value: string, locale: string, justNowLabel: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return justNowLabel;
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }

  const diffHour = Math.round(diffMin / 60);

  if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  }

  const diffDay = Math.round(diffHour / 24);

  return rtf.format(-diffDay, "day");
}

type OverflowTipChildProps = {
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  ref?: Ref<HTMLElement>;
};

function OverflowTip({
  children,
  content,
}: {
  children: ReactElement<OverflowTipChildProps>;
  content: string;
}) {
  const elementRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const childRef = children.props.ref;

  const updateOverflow = useCallback(() => {
    const element = elementRef.current;
    const next = Boolean(element && isElementOverflowing(element));
    setIsOverflowing((current) => (current === next ? current : next));
    return next;
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (typeof window === "undefined") {
      updateOverflow();
      return;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    if (typeof window.requestAnimationFrame === "function") {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateOverflow();
      });
      return;
    }

    frameRef.current = null;
    updateOverflow();
  }, [updateOverflow]);

  const setElementRef = useCallback(
    (node: HTMLElement | null) => {
      elementRef.current = node;
      assignRef(childRef, node);
      scheduleUpdate();
    },
    [childRef, scheduleUpdate],
  );

  useEffect(() => {
    scheduleUpdate();

    const element = elementRef.current;
    if (!element || typeof window === "undefined") {
      return () => {
        if (typeof window !== "undefined" && frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      };
    }

    const handleLayoutChange = () => {
      scheduleUpdate();
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleLayoutChange);
    resizeObserver?.observe(element);
    if (element.parentElement) {
      resizeObserver?.observe(element.parentElement);
    }

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(handleLayoutChange);
    mutationObserver?.observe(element, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", handleLayoutChange);
    document.fonts?.ready.then(handleLayoutChange).catch(() => undefined);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", handleLayoutChange);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [content, scheduleUpdate]);

  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {cloneElement(children, {
            onFocus: (event: FocusEvent<HTMLElement>) => {
              updateOverflow();
              children.props.onFocus?.(event);
            },
            onPointerEnter: (event: PointerEvent<HTMLElement>) => {
              updateOverflow();
              children.props.onPointerEnter?.(event);
            },
            ref: setElementRef,
          })}
        </TooltipTrigger>
        {isOverflowing ? (
          <TooltipContent className="max-w-xs whitespace-normal text-left leading-snug">
            {content}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  );
}

function isElementOverflowing(element: HTMLElement): boolean {
  return (
    element.scrollWidth - element.clientWidth > 1 ||
    element.scrollHeight - element.clientHeight > 1
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  (ref as { current: T | null }).current = value;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}
