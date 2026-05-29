"use client";

import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";

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
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const loadReferences = useCallback(
    async (options?: { realtime?: boolean }) => {
      if (!spaceId || !targetDocumentId) {
        return;
      }

      if (!options?.realtime) {
        setIsLoading(true);
        setErrorKey(null);
      }

      try {
        const page = await listReferencingDocuments({
          organizationId,
          page: 1,
          pageSize: REFERENCING_DOCUMENTS_PAGE_SIZE,
          spaceId,
          targetDocumentId,
        });

        setItems(page.items);
        setTotal(page.total);
      } catch (error) {
        if (!options?.realtime) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (!options?.realtime) {
          setIsLoading(false);
        }
      }
    },
    [organizationId, spaceId, targetDocumentId],
  );

  useEffect(() => {
    void loadReferences();
  }, [loadReferences]);

  useRealtimeInvalidation(["resource-documents"], () => {
    void loadReferences({ realtime: true });
  });

  const remainingCount = Math.max(total - items.length, 0);

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

      {remainingCount > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {t("more", { count: remainingCount })}
        </p>
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
