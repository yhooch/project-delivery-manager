"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Expand,
  Loader2,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../ui/dialog";

type DocumentMermaidDiagramProps = {
  className?: string;
  source: string;
};

type MermaidRenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error" };
type MermaidThemeMode = "dark" | "light";
type MermaidPreviewTransform = {
  scale: number;
  x: number;
  y: number;
};
type MermaidPreviewDragState = {
  originX: number;
  originY: number;
  pointerId: number;
  startX: number;
  startY: number;
};

const MERMAID_MAX_SOURCE_LENGTH = 100_000;
const MERMAID_PREVIEW_DEFAULT_TRANSFORM: MermaidPreviewTransform = {
  scale: 1,
  x: 0,
  y: 0,
};
const MERMAID_PREVIEW_MAX_SCALE = 4;
const MERMAID_PREVIEW_MIN_SCALE = 0.25;
const MERMAID_PREVIEW_ZOOM_STEP = 0.2;
const MERMAID_SECURE_CONFIG_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
];
const MERMAID_LIGHT_THEME = {
  background: "#ffffff",
  clusterBkg: "#f8fafc",
  clusterBorder: "#cbd5e1",
  edgeLabelBackground: "#ffffff",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: "15px",
  lineColor: "#64748b",
  mainBkg: "#f8fafc",
  nodeBorder: "#64748b",
  primaryBorderColor: "#6366f1",
  primaryColor: "#f8fafc",
  primaryTextColor: "#0f172a",
  secondaryBorderColor: "#94a3b8",
  secondaryColor: "#eef2ff",
  tertiaryBorderColor: "#cbd5e1",
  tertiaryColor: "#ffffff",
  textColor: "#0f172a",
} as const;
const MERMAID_DARK_THEME = {
  background: "#0b1020",
  clusterBkg: "#111827",
  clusterBorder: "#475569",
  edgeLabelBackground: "#0b1020",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: "15px",
  lineColor: "#94a3b8",
  mainBkg: "#111827",
  nodeBorder: "#64748b",
  primaryBorderColor: "#818cf8",
  primaryColor: "#111827",
  primaryTextColor: "#f8fafc",
  secondaryBorderColor: "#38bdf8",
  secondaryColor: "#0f2437",
  tertiaryBorderColor: "#64748b",
  tertiaryColor: "#161f2f",
  textColor: "#f8fafc",
} as const;

export function DocumentMermaidDiagram({
  className,
  source,
}: DocumentMermaidDiagramProps) {
  const t = useTranslations("documents.markdown");
  const reactId = useId();
  const diagramSource = useMemo(() => source.trim(), [source]);
  const themeMode = useMermaidThemeMode();
  const renderId = useMemo(
    () => createMermaidRenderId(reactId, diagramSource, themeMode),
    [diagramSource, reactId, themeMode],
  );
  const [state, setState] = useState<MermaidRenderState>({ status: "loading" });
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (
        diagramSource.length === 0 ||
        diagramSource.length > MERMAID_MAX_SOURCE_LENGTH
      ) {
        setState({ status: "error" });
        return;
      }

      setState({ status: "loading" });

      try {
        const { default: mermaid } = await import("mermaid");

        mermaid.initialize({
          maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
          secure: MERMAID_SECURE_CONFIG_KEYS,
          securityLevel: "strict",
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: getMermaidThemeVariables(themeMode),
        });

        const { svg } = await mermaid.render(renderId, diagramSource);

        if (!cancelled) {
          setState({ status: "rendered", svg });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramSource, renderId, themeMode]);

  if (state.status === "rendered") {
    return (
      <div className={cn("group relative my-4 w-full", className)}>
        <figure
          className={cn(
            "flex w-full overflow-x-auto rounded-md border border-border bg-muted/20 p-4 shadow-sm",
            "[&_svg]:h-auto [&_svg]:max-w-none [&_svg]:shrink-0",
            "[&_svg_.edge-thickness-normal]:stroke-[1.6px]",
            "[&_svg_.nodeLabel]:font-medium",
          )}
          data-testid="document-mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        <Button
          aria-label={t("mermaidPreviewOpen")}
          className="absolute right-2 top-2 z-10 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
          data-testid="document-mermaid-fullscreen-open"
          onClick={() => {
            setPreviewOpen(true);
          }}
          size="icon"
          title={t("mermaidPreviewOpen")}
          type="button"
          variant="secondary"
        >
          <Expand className="h-4 w-4" aria-hidden="true" />
        </Button>
        <MermaidPreviewDialog
          onOpenChange={setPreviewOpen}
          open={previewOpen}
          svg={state.svg}
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className={cn(
          "my-4 flex min-h-32 w-full items-center justify-center rounded-md border border-border bg-muted/30 px-3 py-6 text-xs text-muted-foreground",
          className,
        )}
        data-testid="document-mermaid-loading"
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        {t("mermaidLoading")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "my-4 w-full overflow-hidden rounded-md border border-border bg-muted/40",
        className,
      )}
      data-testid="document-mermaid-fallback"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("mermaidError")}
      </div>
      <pre className="w-full overflow-x-auto p-3 font-mono text-xs leading-6 text-foreground">
        <code>{source}</code>
      </pre>
    </div>
  );
}

function MermaidPreviewDialog({
  onOpenChange,
  open,
  svg,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  svg: string;
}) {
  const t = useTranslations("documents.markdown");
  const dragStateRef = useRef<MermaidPreviewDragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [transform, setTransform] = useState<MermaidPreviewTransform>(
    MERMAID_PREVIEW_DEFAULT_TRANSFORM,
  );

  const fitToViewport = useCallback(() => {
    dragStateRef.current = null;
    setIsDragging(false);
    setTransform(MERMAID_PREVIEW_DEFAULT_TRANSFORM);
  }, []);

  useEffect(() => {
    if (open) {
      fitToViewport();
    }
  }, [fitToViewport, open]);

  const updateScale = useCallback((delta: number) => {
    setTransform((currentTransform) => ({
      ...currentTransform,
      scale: clampMermaidPreviewScale(currentTransform.scale + delta),
    }));
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      dragStateRef.current = {
        originX: transform.x,
        originY: transform.y,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      setIsDragging(true);

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is not available in some test environments.
      }
    },
    [transform.x, transform.y],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const currentDragState = dragStateRef.current;

      if (!currentDragState || currentDragState.pointerId !== event.pointerId) {
        return;
      }

      setTransform((currentTransform) => ({
        ...currentTransform,
        x: currentDragState.originX + event.clientX - currentDragState.startX,
        y: currentDragState.originY + event.clientY - currentDragState.startY,
      }));
    },
    [],
  );

  const stopDragging = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const currentDragState = dragStateRef.current;

      if (!currentDragState || currentDragState.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setIsDragging(false);

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture is not available in some test environments.
      }
    },
    [],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      updateScale(
        event.deltaY < 0
          ? MERMAID_PREVIEW_ZOOM_STEP
          : -MERMAID_PREVIEW_ZOOM_STEP,
      );
    },
    [updateScale],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-50 flex h-dvh w-dvw max-w-none flex-col overflow-hidden border border-border bg-card text-foreground shadow-2xl outline-none duration-200",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          data-testid="document-mermaid-preview-dialog"
        >
          <div className="flex min-h-12 items-center gap-2 border-b border-border bg-muted/30 px-2 py-2 sm:px-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm leading-6">
              {t("mermaidPreviewTitle")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("mermaidPreviewDescription")}
            </DialogDescription>
            <div className="flex shrink-0 items-center gap-1">
              <MermaidPreviewToolbarButton
                label={t("mermaidZoomOut")}
                onClick={() => {
                  updateScale(-MERMAID_PREVIEW_ZOOM_STEP);
                }}
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </MermaidPreviewToolbarButton>
              <MermaidPreviewToolbarButton
                label={t("mermaidZoomIn")}
                onClick={() => {
                  updateScale(MERMAID_PREVIEW_ZOOM_STEP);
                }}
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </MermaidPreviewToolbarButton>
              <MermaidPreviewToolbarButton
                label={t("mermaidReset")}
                onClick={fitToViewport}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </MermaidPreviewToolbarButton>
              <MermaidPreviewToolbarButton
                label={t("mermaidFit")}
                onClick={fitToViewport}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </MermaidPreviewToolbarButton>
              <DialogClose asChild>
                <Button
                  aria-label={t("mermaidClose")}
                  className="h-8 w-8 shrink-0"
                  size="icon"
                  title={t("mermaidClose")}
                  type="button"
                  variant="ghost"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DialogClose>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            <div
              className={cn(
                "absolute inset-0 flex touch-none items-center justify-center overflow-hidden p-3 sm:p-6",
                isDragging ? "cursor-grabbing" : "cursor-grab",
              )}
              data-testid="document-mermaid-preview-viewport"
              onPointerCancel={stopDragging}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onWheel={handleWheel}
            >
              <div
                className={cn(
                  "will-change-transform",
                  "[&_svg]:block [&_svg]:h-auto [&_svg]:max-h-[calc(100dvh-7rem)] [&_svg]:max-w-[calc(100vw-2rem)] [&_svg]:select-none",
                )}
                data-testid="document-mermaid-preview-transform"
                dangerouslySetInnerHTML={{ __html: svg }}
                style={{
                  transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
                  transformOrigin: "center",
                }}
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function MermaidPreviewToolbarButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="h-8 w-8 shrink-0"
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function clampMermaidPreviewScale(scale: number): number {
  const clampedScale = Math.min(
    MERMAID_PREVIEW_MAX_SCALE,
    Math.max(MERMAID_PREVIEW_MIN_SCALE, scale),
  );

  return Math.round(clampedScale * 100) / 100;
}

function createMermaidRenderId(
  reactId: string,
  source: string,
  themeMode: MermaidThemeMode,
): string {
  return `document-mermaid-${themeMode}-${reactId.replaceAll(/[^A-Za-z0-9_-]/gu, "")}-${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getMermaidThemeVariables(themeMode: MermaidThemeMode) {
  return themeMode === "dark" ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME;
}

function getCurrentMermaidThemeMode(): MermaidThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useMermaidThemeMode(): MermaidThemeMode {
  const [themeMode, setThemeMode] = useState<MermaidThemeMode>(
    getCurrentMermaidThemeMode,
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const updateThemeMode = () => {
      setThemeMode(getCurrentMermaidThemeMode());
    };
    const observer = new MutationObserver(updateThemeMode);

    updateThemeMode();
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return themeMode;
}
