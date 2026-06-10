"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
type MermaidPreviewMetrics = {
  height: number;
  width: number;
};
type MermaidPreviewDragState = {
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
  startX: number;
  startY: number;
};
type MermaidPreviewViewportSize = {
  height: number;
  width: number;
};
type MermaidPreviewScrollAnchor = {
  viewportX: number;
  viewportY: number;
};

const MERMAID_MAX_SOURCE_LENGTH = 100_000;
const MERMAID_PREVIEW_MAX_SCALE = 4;
const MERMAID_PREVIEW_MIN_SCALE = 0.05;
const MERMAID_PREVIEW_ZOOM_FACTOR = 1.2;
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
  const openPreview = useCallback(() => {
    setPreviewOpen(true);
  }, []);
  const handlePreviewKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      openPreview();
    },
    [openPreview],
  );

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
      <div className={cn("relative my-4 w-full", className)}>
        <figure
          aria-label={t("mermaidPreviewOpen")}
          className={cn(
            "flex w-full cursor-zoom-in overflow-x-auto rounded-md border border-border bg-muted/20 p-4 shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "[&_svg]:h-auto [&_svg]:max-w-none [&_svg]:shrink-0",
            "[&_svg_.edge-thickness-normal]:stroke-[1.6px]",
            "[&_svg_.nodeLabel]:font-medium",
          )}
          data-testid="document-mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: state.svg }}
          onClick={openPreview}
          onKeyDown={handlePreviewKeyDown}
          role="button"
          tabIndex={0}
          title={t("mermaidPreviewOpen")}
        />
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
  const previousOpenRef = useRef(open);
  const pendingScrollAnchorRef = useRef<MermaidPreviewScrollAnchor | null>(
    null,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFitMode, setIsFitMode] = useState(true);
  const [scale, setScale] = useState(1);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [viewportSize, setViewportSize] = useState<MermaidPreviewViewportSize>({
    height: 0,
    width: 0,
  });
  const svgMetrics = useMemo(() => getMermaidPreviewMetrics(svg), [svg]);
  const fitScale = useMemo(
    () => getMermaidPreviewFitScale(svgMetrics, viewportSize),
    [svgMetrics, viewportSize],
  );
  const previewSize = useMemo(
    () =>
      svgMetrics
        ? {
            height: Math.round(svgMetrics.height * scale * 100) / 100,
            width: Math.round(svgMetrics.width * scale * 100) / 100,
          }
        : null,
    [scale, svgMetrics],
  );

  const fitToViewport = useCallback(() => {
    dragStateRef.current = null;
    setIsDragging(false);
    setIsFitMode(true);
    setScale(fitScale);

    const viewport = viewportRef.current;

    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [fitScale]);

  const setViewportRef = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      fitToViewport();
    }

    previousOpenRef.current = open;
  }, [fitToViewport, open]);

  useEffect(() => {
    if (!open || !isFitMode) {
      return;
    }

    setScale(fitScale);
  }, [fitScale, isFitMode, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!viewportElement) {
      return;
    }

    const updateViewportSize = () => {
      setViewportSize({
        height: viewportElement.clientHeight,
        width: viewportElement.clientWidth,
      });
    };

    const animationFrame = window.requestAnimationFrame(updateViewportSize);

    window.addEventListener("resize", updateViewportSize);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", updateViewportSize);
      };
    }

    const resizeObserver = new ResizeObserver(updateViewportSize);

    resizeObserver.observe(viewportElement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateViewportSize);
      resizeObserver.disconnect();
    };
  }, [open, viewportElement]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = pendingScrollAnchorRef.current;

    if (!viewport || !anchor) {
      return;
    }

    pendingScrollAnchorRef.current = null;
    viewport.scrollLeft = Math.max(
      0,
      anchor.viewportX - viewport.clientWidth / 2,
    );
    viewport.scrollTop = Math.max(
      0,
      anchor.viewportY - viewport.clientHeight / 2,
    );
  }, [scale]);

  const updateScale = useCallback(
    (nextScale: number, anchor?: MermaidPreviewScrollAnchor) => {
      const clampedScale = clampMermaidPreviewScale(nextScale);

      setIsFitMode(false);

      if (anchor && scale > 0) {
        pendingScrollAnchorRef.current = {
          viewportX: (anchor.viewportX * clampedScale) / scale,
          viewportY: (anchor.viewportY * clampedScale) / scale,
        };
      } else {
        const viewport = viewportRef.current;

        pendingScrollAnchorRef.current = viewport
          ? {
              viewportX:
                (viewport.scrollLeft + viewport.clientWidth / 2) *
                (clampedScale / scale),
              viewportY:
                (viewport.scrollTop + viewport.clientHeight / 2) *
                (clampedScale / scale),
            }
          : null;
      }

      setScale(clampedScale);
    },
    [scale],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
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
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const currentDragState = dragStateRef.current;

      if (!currentDragState || currentDragState.pointerId !== event.pointerId) {
        return;
      }

      event.currentTarget.scrollLeft =
        currentDragState.scrollLeft + currentDragState.startX - event.clientX;
      event.currentTarget.scrollTop =
        currentDragState.scrollTop + currentDragState.startY - event.clientY;
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
      const viewportRect = event.currentTarget.getBoundingClientRect();
      const anchor = {
        viewportX:
          event.currentTarget.scrollLeft + event.clientX - viewportRect.left,
        viewportY:
          event.currentTarget.scrollTop + event.clientY - viewportRect.top,
      };
      const nextScale =
        event.deltaY < 0
          ? scale * MERMAID_PREVIEW_ZOOM_FACTOR
          : scale / MERMAID_PREVIEW_ZOOM_FACTOR;

      updateScale(nextScale, anchor);
    },
    [scale, updateScale],
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
                  updateScale(scale / MERMAID_PREVIEW_ZOOM_FACTOR);
                }}
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </MermaidPreviewToolbarButton>
              <MermaidPreviewToolbarButton
                label={t("mermaidZoomIn")}
                onClick={() => {
                  updateScale(scale * MERMAID_PREVIEW_ZOOM_FACTOR);
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
                "absolute inset-0 touch-none overflow-auto p-3 sm:p-6",
                isDragging ? "cursor-grabbing" : "cursor-grab",
              )}
              data-testid="document-mermaid-preview-viewport"
              onPointerCancel={stopDragging}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onWheel={handleWheel}
              ref={setViewportRef}
            >
              <div
                className={cn(
                  "mx-auto",
                  "[&_svg]:!block [&_svg]:!h-full [&_svg]:!max-h-none [&_svg]:!max-w-none [&_svg]:!select-none [&_svg]:!w-full",
                )}
                data-testid="document-mermaid-preview-transform"
                dangerouslySetInnerHTML={{ __html: svg }}
                style={
                  previewSize
                    ? {
                        height: `${previewSize.height}px`,
                        width: `${previewSize.width}px`,
                      }
                    : undefined
                }
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

function getMermaidPreviewFitScale(
  metrics: MermaidPreviewMetrics | null,
  viewportSize: MermaidPreviewViewportSize,
): number {
  if (
    !metrics ||
    viewportSize.height <= 0 ||
    viewportSize.width <= 0 ||
    metrics.height <= 0 ||
    metrics.width <= 0
  ) {
    return 1;
  }

  const scale = Math.min(
    viewportSize.width / metrics.width,
    viewportSize.height / metrics.height,
  );

  return clampMermaidPreviewScale(scale);
}

function getMermaidPreviewMetrics(svg: string): MermaidPreviewMetrics | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const svgElement = document.querySelector("svg");

  if (!svgElement) {
    return null;
  }

  const viewBox = svgElement.getAttribute("viewBox");

  if (viewBox) {
    const [, , width, height] = viewBox
      .trim()
      .split(/[\s,]+/u)
      .map(Number);

    if (isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
      return { height, width };
    }
  }

  const width = parseSvgLength(svgElement.getAttribute("width"));
  const height = parseSvgLength(svgElement.getAttribute("height"));

  if (isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
    return { height, width };
  }

  return null;
}

function parseSvgLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsedValue = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function isPositiveFiniteNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
