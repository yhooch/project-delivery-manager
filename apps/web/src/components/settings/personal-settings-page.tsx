"use client";

import type {
  AuthorizedMcpClient,
  McpAuthorizedClientStatus,
  McpScope,
} from "@project-delivery/shared";
import {
  ExternalLink,
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
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import {
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
  const locale = useLocale();
  const { session, status } = useSession();
  const [clients, setClients] = useState<AuthorizedMcpClient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const [actionErrorKey, setActionErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);

  const load = useCallback(
    async ({ silent = false }: LoadOptions = {}) => {
      const sequence = ++loadSequenceRef.current;

      if (status !== "authenticated" || !session) {
        setClients([]);
        setErrorKey(null);
        if (!silent) {
          setIsLoading(false);
        }
        return;
      }

      if (!silent) {
        setIsLoading(true);
      }
      setErrorKey(null);

      try {
        const nextClients = await listAuthorizedMcpClients();
        if (loadSequenceRef.current !== sequence) return;
        setClients(nextClients);
      } catch (error) {
        if (loadSequenceRef.current !== sequence) return;
        setErrorKey(getApiErrorMessageKey(error));
      } finally {
        if (!silent && loadSequenceRef.current === sequence) {
          setIsLoading(false);
        }
      }
    },
    [session, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(client: AuthorizedMcpClient) {
    setPendingClientId(client.clientId);
    setActionErrorKey(null);

    try {
      await revokeAuthorizedMcpClient(client.clientId);
      await load({ silent: true });
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingClientId(null);
    }
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
            onClick={() => void load()}
            disabled={isLoading}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
            />
            {t("actions.refresh")}
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {actionErrorKey && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {tRoot(actionErrorKey)}
          </div>
        )}

        {status === "loading" ? (
          <LoadingState label={t("states.loading")} />
        ) : status === "unauthenticated" || !session ? (
          <ErrorState
            title={t("states.unauthenticated.title")}
            message={t("states.unauthenticated.description")}
          />
        ) : isLoading ? (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <ListSkeleton rows={5} />
          </div>
        ) : errorKey ? (
          <ErrorState
            title={t("states.error.title")}
            message={tRoot(errorKey)}
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
      </div>
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

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 min-w-0 text-xs text-foreground">{children}</div>
    </div>
  );
}

function scopeLabel(
  scope: McpScope,
  tScopes: TranslationFn,
): string {
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
