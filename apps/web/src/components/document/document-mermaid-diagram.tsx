"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";

import { cn } from "../../lib/utils";

type DocumentMermaidDiagramProps = {
  className?: string;
  source: string;
};

type MermaidRenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error" };
type MermaidThemeMode = "dark" | "light";

const MERMAID_MAX_SOURCE_LENGTH = 100_000;
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
      <figure
        className={cn(
          "my-4 flex w-full overflow-x-auto rounded-md border border-border bg-muted/20 p-4 shadow-sm",
          "[&_svg]:h-auto [&_svg]:max-w-none [&_svg]:shrink-0",
          "[&_svg_.edge-thickness-normal]:stroke-[1.6px]",
          "[&_svg_.nodeLabel]:font-medium",
          className,
        )}
        data-testid="document-mermaid-diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
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
