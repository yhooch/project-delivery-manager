"use client";

import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  listReferencingDocuments,
  type DocumentSummary,
} from "../../lib/document-service";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { Link } from "../../i18n/routing";
import {
  getDocumentDisplayCode,
  getDocumentSourceKey,
} from "../../lib/document-view-model";
import { useRealtimeInvalidation } from "../../lib/realtime";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

const REFERENCING_DOCUMENTS_PAGE_SIZE = 5;
// 后端 pageSize 上限为 100，逐页展开时据此封顶。
const MAX_REFERENCING_PAGE_SIZE = 100;

type ReferencingDocumentsSectionProps = {
  className?: string;
  compact?: boolean;
  hideHeader?: boolean;
  organizationId?: string;
  spaceId: string;
  targetDocumentId: string;
  title: string;
};

export function ReferencingDocumentsSection({
  className,
  compact = false,
  hideHeader = false,
  organizationId,
  spaceId,
  targetDocumentId,
  title,
}: ReferencingDocumentsSectionProps) {
  const t = useTranslations("documents.references");
  const tDocuments = useTranslations("documents");
  const tRoot = useTranslations();
  const titleId = useId();
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // 已展开的页数；实时刷新时据此重新拉取，避免把已展开内容缩回首屏。
  const loadedPagesRef = useRef(1);

  const loadReferences = useCallback(
    async (
      targetPageCount: number,
      options?: { realtime?: boolean; more?: boolean },
    ) => {
      if (!spaceId || !targetDocumentId) {
        return;
      }

      const isBackground = Boolean(options?.realtime || options?.more);
      if (!isBackground) {
        setIsLoading(true);
        setErrorKey(null);
      }

      try {
        const pageSize = Math.min(
          targetPageCount * REFERENCING_DOCUMENTS_PAGE_SIZE,
          MAX_REFERENCING_PAGE_SIZE,
        );
        const page = await listReferencingDocuments({
          organizationId,
          page: 1,
          pageSize,
          spaceId,
          targetDocumentId,
        });

        setItems(page.items);
        setTotal(page.total);
      } catch (error) {
        // 后台刷新/加载更多失败时静默保留已有列表，仅首屏加载失败才提示。
        if (!isBackground) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (!isBackground) {
          setIsLoading(false);
        }
      }
    },
    [organizationId, spaceId, targetDocumentId],
  );

  useEffect(() => {
    loadedPagesRef.current = 1;
    void loadReferences(1);
  }, [loadReferences]);

  useRealtimeInvalidation(["resource-documents"], () => {
    void loadReferences(loadedPagesRef.current, { realtime: true });
  });

  const handleLoadMore = useCallback(async () => {
    const next = loadedPagesRef.current + 1;
    setIsLoadingMore(true);
    try {
      await loadReferences(next, { more: true });
      loadedPagesRef.current = next;
    } finally {
      setIsLoadingMore(false);
    }
  }, [loadReferences]);

  const remainingCount = Math.max(total - items.length, 0);
  // 后端 pageSize 封顶 100，到顶后不再展示「加载更多」以免按钮失效。
  const canLoadMore =
    remainingCount > 0 && items.length < MAX_REFERENCING_PAGE_SIZE;

  return (
    <section
      aria-label={hideHeader ? title : undefined}
      aria-labelledby={hideHeader ? undefined : titleId}
      className={cn(
        "grid gap-3",
        compact ? "text-xs" : "border-t border-border/60 pt-6",
        className,
      )}
      data-testid="referencing-documents-section"
    >
      {!hideHeader ? (
        <header className="flex items-center justify-between gap-2">
          <h2
            className={cn(
              "font-semibold text-foreground",
              compact ? "text-xs" : "text-sm",
            )}
            id={titleId}
          >
            {title}
          </h2>
          {total > 0 ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("count", { count: total })}
            </span>
          ) : null}
        </header>
      ) : total > 0 ? (
        <span className="text-[11px] text-muted-foreground">
          {t("count", { count: total })}
        </span>
      ) : null}

      {isLoading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("loading")}
        </div>
      ) : errorKey ? (
        <p className="text-xs text-destructive" role="alert">
          {tRoot(errorKey)}
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-1.5" data-testid="referencing-documents-list">
          {items.map((document) => (
            <ReferencingDocumentRow
              compact={compact}
              document={document}
              key={document.id}
              t={t}
              tDocuments={tDocuments}
            />
          ))}
        </ul>
      )}

      {canLoadMore ? (
        <button
          type="button"
          onClick={() => void handleLoadMore()}
          disabled={isLoadingMore}
          className="flex w-fit items-center gap-1.5 rounded text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {isLoadingMore ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          {t("more", { count: remainingCount })}
        </button>
      ) : null}
    </section>
  );
}

function ReferencingDocumentRow({
  compact,
  document,
  t,
  tDocuments,
}: {
  compact: boolean;
  document: DocumentSummary;
  t: ReturnType<typeof useTranslations<"documents.references">>;
  tDocuments: ReturnType<typeof useTranslations<"documents">>;
}) {
  const displayCode = getDocumentDisplayCode(document);
  const href =
    document.kind === "REQUIREMENT"
      ? `/requirements/${document.id}`
      : `/documents/${document.id}`;

  return (
    <li>
      <Link
        className={cn(
          "flex min-w-0 items-start gap-2 rounded-md px-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "py-1 text-xs" : "py-1.5 text-sm",
        )}
        data-testid="referencing-document-link"
        href={href}
      >
        <FileText
          aria-hidden="true"
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground",
            compact ? "h-3 w-3" : "h-3.5 w-3.5",
          )}
        />
        <span className={cn("grid min-w-0 flex-1", compact ? "" : "gap-1")}>
          <span className="flex min-w-0 items-center gap-1.5">
            {displayCode ? (
              <span className="shrink-0 font-mono text-[11px] text-foreground">
                {displayCode}
              </span>
            ) : null}
            <span className="truncate text-foreground/90">
              {document.title || t("untitled")}
            </span>
          </span>
          {!compact ? (
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {tDocuments(`kind.${document.kind}`)}
              </Badge>
              <span>
                {tDocuments(getDocumentSourceKey(document.sourceType))}
              </span>
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
