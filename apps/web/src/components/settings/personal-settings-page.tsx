"use client";

import type {
  AuthorizedMcpClient,
  McpAuthorizedClientStatus,
  McpProtectedResourceMetadata,
  McpScope,
} from "@project-delivery/shared";
import {
  Check,
  Copy,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  formatApiErrorDisplayMessage,
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "../shell/api-error-display";
import {
  getMcpProtectedResourceMetadata,
  listAuthorizedMcpClients,
  revokeAuthorizedMcpClient,
} from "../../lib/mcp-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "../v2/states";
import { PageHeader } from "../v2/page-header";

type LoadOptions = {
  silent?: boolean;
};

type TranslationFn = (key: string) => string;

const statusVariant: Record<McpAuthorizedClientStatus, BadgeProps["variant"]> =
  {
    ACTIVE: "success",
    EXPIRED: "warning",
    REVOKED: "destructive",
  };

export function PersonalSettingsPage() {
  const t = useTranslations("personalSettings");
  const tRoot = useTranslations();
  const tScopes = useTranslations("mcp.scopes");
  const requestIdLabel = tRoot("errors.apiDetails.requestId");
  const locale = useLocale();
  const { session, status } = useSession();
  const [clients, setClients] = useState<AuthorizedMcpClient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);
  const [actionError, setActionError] = useState<ApiErrorDisplayState | null>(
    null,
  );
  const [metadata, setMetadata] = useState<McpProtectedResourceMetadata | null>(
    null,
  );
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] =
    useState<ApiErrorDisplayState | null>(null);
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const metadataSequenceRef = useRef(0);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async ({ silent = false }: LoadOptions = {}) => {
      const sequence = ++loadSequenceRef.current;

      if (status !== "authenticated" || !session) {
        setClients([]);
        setError(null);
        if (!silent) {
          setIsLoading(false);
        }
        return;
      }

      if (!silent) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const nextClients = await listAuthorizedMcpClients();
        if (loadSequenceRef.current !== sequence) return;
        setClients(nextClients);
      } catch (error) {
        if (loadSequenceRef.current !== sequence) return;
        setError(getApiErrorDisplay(error, requestIdLabel));
      } finally {
        if (!silent && loadSequenceRef.current === sequence) {
          setIsLoading(false);
        }
      }
    },
    [requestIdLabel, session, status],
  );

  const loadMetadata = useCallback(async () => {
    const sequence = ++metadataSequenceRef.current;
    setMetadataLoading(true);
    setMetadataError(null);

    try {
      const nextMetadata = await getMcpProtectedResourceMetadata();
      if (metadataSequenceRef.current !== sequence) return;
      setMetadata(nextMetadata);
    } catch (error) {
      if (metadataSequenceRef.current !== sequence) return;
      setMetadataError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      if (metadataSequenceRef.current === sequence) {
        setMetadataLoading(false);
      }
    }
  }, [requestIdLabel]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status === "authenticated") {
      void loadMetadata();
    }
  }, [loadMetadata, status]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  async function handleRevoke(client: AuthorizedMcpClient) {
    setPendingClientId(client.clientId);
    setActionError(null);

    try {
      await revokeAuthorizedMcpClient(client.clientId);
      await load({ silent: true });
    } catch (error) {
      setActionError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      setPendingClientId(null);
    }
  }

  async function handleCopy(key: string, value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }

    setCopiedKey(key);

    if (copyResetRef.current) {
      clearTimeout(copyResetRef.current);
    }

    copyResetRef.current = setTimeout(() => {
      setCopiedKey(null);
      copyResetRef.current = null;
    }, 1600);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void load();
              void loadMetadata();
            }}
            disabled={isLoading || metadataLoading}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (isLoading || metadataLoading) && "animate-spin",
              )}
            />
            {t("actions.refresh")}
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {actionError && (
          <div
            role="alert"
            className="mb-4 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {formatApiErrorDisplayMessage(
              tRoot(actionError.messageKey),
              actionError.detailLines,
            )}
          </div>
        )}

        {status === "loading" ? (
          <LoadingState label={t("states.loading")} />
        ) : status === "unauthenticated" || !session ? (
          <ErrorState
            title={t("states.unauthenticated.title")}
            message={t("states.unauthenticated.description")}
          />
        ) : (
          <>
            <McpConnectionGuide
              metadata={metadata}
              loading={metadataLoading}
              error={metadataError}
              copiedKey={copiedKey}
              onCopy={(key, value) => void handleCopy(key, value)}
              onRetry={() => void loadMetadata()}
              t={t}
              tRoot={tRoot}
              tScopes={tScopes}
            />

            <section
              aria-labelledby="authorized-mcp-clients-heading"
              className="mt-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2
                  id="authorized-mcp-clients-heading"
                  className="text-sm font-semibold text-foreground"
                >
                  {t("clients.title")}
                </h2>
              </div>

              {isLoading ? (
                <div className="overflow-hidden rounded-md border border-border bg-card">
                  <ListSkeleton rows={5} />
                </div>
              ) : error ? (
                <ErrorState
                  title={t("states.error.title")}
                  message={formatApiErrorDisplayMessage(
                    tRoot(error.messageKey),
                    error.detailLines,
                    " · ",
                  )}
                  onRetry={() => void load()}
                  retryLabel={t("actions.retry")}
                />
              ) : clients.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title={t("states.empty.title")}
                  description={t("states.empty.description")}
                />
              ) : (
                <ul className="overflow-hidden rounded-md border border-border bg-card">
                  {clients.map((client) => (
                    <AuthorizedClientItem
                      key={client.clientId}
                      client={client}
                      locale={locale}
                      pending={pendingClientId === client.clientId}
                      onRevoke={() => void handleRevoke(client)}
                      t={t}
                      tScopes={tScopes}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function McpConnectionGuide({
  copiedKey,
  error,
  loading,
  metadata,
  onCopy,
  onRetry,
  t,
  tRoot,
  tScopes,
}: {
  copiedKey: string | null;
  error: ApiErrorDisplayState | null;
  loading: boolean;
  metadata: McpProtectedResourceMetadata | null;
  onCopy: (key: string, value: string) => void;
  onRetry: () => void;
  t: TranslationFn;
  tRoot: TranslationFn;
  tScopes: TranslationFn;
}) {
  const resourceUrl = metadata?.resource;
  const hasError = Boolean(error);
  const showLoading = loading || (!metadata && !hasError);

  return (
    <section
      aria-labelledby="mcp-connection-guide-heading"
      className="rounded-md border border-border bg-card p-4"
      data-testid="personal-settings-mcp-guide"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <h2
              id="mcp-connection-guide-heading"
              className="text-sm font-semibold text-foreground"
            >
              {t("guide.title")}
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            {t("guide.description")}
          </p>
        </div>
        {hasError && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("actions.retry")}
          </Button>
        )}
      </div>

      {showLoading ? (
        <div className="mt-4 grid gap-2">
          <div className="h-12 animate-pulse rounded-md bg-muted" />
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        </div>
      ) : hasError || !metadata ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          {error
            ? formatApiErrorDisplayMessage(
                tRoot(error.messageKey),
                error.detailLines,
                " · ",
              )
            : t("guide.states.error")}
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <GuideEndpointRow
              label={t("guide.fields.resourceUrl")}
              value={resourceUrl}
              copyKey="resource"
              copiedKey={copiedKey}
              onCopy={onCopy}
              t={t}
            />
          </div>

          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("guide.fields.scopes")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metadata.scopes_supported.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scopeLabel(scope, tScopes)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div>
              <div className="text-xs font-semibold text-foreground">
                {t("guide.steps.title")}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                <li>{t("guide.steps.resource")}</li>
                <li>{t("guide.steps.oauth")}</li>
                <li>{t("guide.steps.review")}</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function GuideEndpointRow({
  copiedKey,
  copyKey,
  label,
  onCopy,
  t,
  value,
}: {
  copiedKey: string | null;
  copyKey: string;
  label: string;
  onCopy: (key: string, value: string) => void;
  t: TranslationFn;
  value?: string;
}) {
  if (!value) return null;

  const copied = copiedKey === copyKey;

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <code className="min-w-0 break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
        {value}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`${copied ? t("actions.copied") : t("actions.copy")} ${label}`}
        onClick={() => onCopy(copyKey, value)}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

function AuthorizedClientItem({
  client,
  locale,
  onRevoke,
  pending,
  t,
  tScopes,
}: {
  client: AuthorizedMcpClient;
  locale: string;
  onRevoke: () => void;
  pending: boolean;
  t: TranslationFn;
  tScopes: TranslationFn;
}) {
  const source = getClientSource(client);
  const canRevoke = client.status === "ACTIVE";

  return (
    <li className="grid gap-4 border-b border-border p-4 last:border-b-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {client.clientName}
          </h2>
          <Badge variant={statusVariant[client.status]}>
            {t(`status.${client.status}`)}
          </Badge>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Field label={t("fields.clientId")}>
            <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              {client.clientId}
            </code>
          </Field>
          <Field label={t("fields.source")}>
            {client.clientUri ? (
              <a
                href={client.clientUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="truncate">{source}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <span className="break-all text-muted-foreground">
                {source ?? t("fields.unknownSource")}
              </span>
            )}
          </Field>
        </div>
      </div>

      <Field label={t("fields.scopes")}>
        <div className="flex flex-wrap gap-1.5">
          {client.scopes.map((scope) => (
            <Badge key={scope} variant="outline">
              {scopeLabel(scope, tScopes)}
            </Badge>
          ))}
        </div>
      </Field>

      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
        <Field label={t("fields.authorizedAt")}>
          {formatDateTime(client.authorizedAt, locale)}
        </Field>
        <Field label={t("fields.lastUsedAt")}>
          {client.lastUsedAt
            ? formatDateTime(client.lastUsedAt, locale)
            : t("fields.neverUsed")}
        </Field>
      </div>

      <div className="flex lg:justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canRevoke || pending}
          onClick={onRevoke}
          className={cn(canRevoke && "text-destructive hover:text-destructive")}
        >
          <Unplug className="h-3.5 w-3.5" />
          {pending ? t("actions.revoking") : t("actions.revoke")}
        </Button>
      </div>
    </li>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 min-w-0 text-xs text-foreground">{children}</div>
    </div>
  );
}

function scopeLabel(scope: McpScope, tScopes: TranslationFn): string {
  return tScopes(scope);
}

function getClientSource(client: AuthorizedMcpClient): string | undefined {
  if (!client.clientUri) {
    return undefined;
  }

  try {
    return new URL(client.clientUri).hostname;
  } catch {
    return client.clientUri;
  }
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
