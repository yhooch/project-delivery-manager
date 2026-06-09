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

const MERMAID_MAX_SOURCE_LENGTH = 100_000;
const MERMAID_SECURE_CONFIG_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
];

export function DocumentMermaidDiagram({
  className,
  source,
}: DocumentMermaidDiagramProps) {
  const t = useTranslations("documents.markdown");
  const reactId = useId();
  const diagramSource = useMemo(() => source.trim(), [source]);
  const renderId = useMemo(
    () => createMermaidRenderId(reactId, diagramSource),
    [diagramSource, reactId],
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
          theme: getMermaidTheme(),
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
  }, [diagramSource, renderId]);

  if (state.status === "rendered") {
    return (
      <figure
        className={cn(
          "my-4 w-full overflow-x-auto rounded-md border border-border bg-background p-3",
          "[&_svg]:h-auto [&_svg]:max-w-none",
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

function createMermaidRenderId(reactId: string, source: string): string {
  return `document-mermaid-${reactId.replaceAll(/[^A-Za-z0-9_-]/gu, "")}-${hashString(source)}`;
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getMermaidTheme(): "dark" | "neutral" {
  if (typeof document === "undefined") {
    return "neutral";
  }

  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "neutral";
}
