"use client";

import type {
  McpOAuthAuthorizeContext,
  McpScope,
} from "@project-delivery/shared";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  LockKeyhole,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Link } from "../../i18n/routing";
import {
  McpOAuthAuthorizeError,
  createMcpOAuthAccessDeniedUrl,
  createMcpOAuthApproveAuthorizeUrl,
  getMcpOAuthAuthorizeContext,
  isUnauthorizedMcpOAuthAuthorizeError,
} from "../../lib/mcp-service";
import { useSession } from "../providers/session-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ErrorState, LoadingState } from "../v2/states";

type TranslationFn = (key: string) => string;

export function McpAuthorizePage() {
  const t = useTranslations("oauth.mcpAuthorize");
  const tRoot = useTranslations();
  const tScopes = useTranslations("mcp.scopes");
  const searchParams = useSearchParams();
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);
  const { status } = useSession();
  const [context, setContext] = useState<McpOAuthAuthorizeContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const load = useCallback(async () => {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nextContext = await getMcpOAuthAuthorizeContext(queryString);
      setContext(nextContext);
    } catch (nextError) {
      setContext(null);
      setError(nextError);
    } finally {
      setIsLoading(false);
    }
  }, [queryString, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleConfirm() {
    setIsConfirming(true);
    window.location.assign(createMcpOAuthApproveAuthorizeUrl(queryString));
  }

  function handleReject() {
    if (!context) {
      window.history.back();
      return;
    }

    setIsRejecting(true);
    window.location.assign(createMcpOAuthAccessDeniedUrl(context));
  }

  if (status === "loading") {
    return (
      <AuthorizeShell>
        <LoadingState label={t("states.sessionLoading")} />
      </AuthorizeShell>
    );
  }

  if (status === "unauthenticated" || isUnauthorizedMcpOAuthAuthorizeError(error)) {
    return (
      <AuthorizeShell>
        <AuthMessage
          icon={<LockKeyhole className="h-5 w-5" />}
          title={t("states.unauthenticated.title")}
          description={t("states.unauthenticated.description")}
          action={
            <Button asChild size="sm">
              <Link href="/login">{t("actions.signIn")}</Link>
            </Button>
          }
        />
      </AuthorizeShell>
    );
  }

  if (isLoading) {
    return (
      <AuthorizeShell>
        <LoadingState label={t("states.loading")} />
      </AuthorizeShell>
    );
  }

  if (error || !context) {
    return (
      <AuthorizeShell>
        <ErrorState
          title={t("states.error.title")}
          message={getErrorMessage(error, tRoot)}
          onRetry={() => void load()}
          retryLabel={t("actions.retry")}
        />
      </AuthorizeShell>
    );
  }

  const source = getClientSource(context);
  const sourceHref =
    context.client.clientUri ??
    context.client.metadataDocumentUri ??
    getUrlOrUndefined(context.client.clientId);

  return (
    <AuthorizeShell>
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <header className="border-b border-border px-5 py-4 sm:px-6">
          <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
            {t("eyebrow")}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description", { clientName: context.client.clientName })}
          </p>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-foreground">
                {context.client.clientName}
              </h2>
              <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {context.client.clientId}
              </p>
            </div>
          </div>

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <AuthorizeField label={t("fields.source")}>
              {sourceHref ? (
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="truncate">{source}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                <span className="break-all">{source}</span>
              )}
            </AuthorizeField>
            <AuthorizeField label={t("fields.redirectHost")}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {context.redirectHostname}
              </code>
            </AuthorizeField>
            <AuthorizeField label={t("fields.registrationMode")}>
              {t(`registrationMode.${context.client.registrationMode}`)}
            </AuthorizeField>
            <AuthorizeField label={t("fields.resource")}>
              <span className="break-all font-mono text-xs">
                {context.resource}
              </span>
            </AuthorizeField>
          </div>

          <AuthorizeField label={t("fields.scopes")}>
            <div className="flex flex-wrap gap-1.5">
              {context.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scopeLabel(scope, tScopes)}
                </Badge>
              ))}
            </div>
          </AuthorizeField>

          <RiskNotice
            title={t("risk.title")}
            description={t("risk.description")}
          />
          {context.redirectIsLocalhost && (
            <RiskNotice
              tone="warning"
              title={t("risk.localhostTitle")}
              description={t("risk.localhostDescription")}
            />
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleReject}
            disabled={isConfirming || isRejecting}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {isRejecting ? t("actions.rejecting") : t("actions.reject")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming || isRejecting}
          >
            <Check className="h-3.5 w-3.5" />
            {isConfirming ? t("actions.confirming") : t("actions.confirm")}
          </Button>
        </footer>
      </section>
    </AuthorizeShell>
  );
}

function AuthorizeShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col justify-center">
        {children}
      </div>
    </main>
  );
}

function AuthMessage({
  action,
  description,
  icon,
  title,
}: {
  action: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </div>
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </section>
  );
}

function AuthorizeField({
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
      <div className="mt-1 min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

function RiskNotice({
  description,
  title,
  tone = "default",
}: {
  description: string;
  title: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={
        tone === "warning"
          ? "flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
          : "flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-warning"
      }
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function scopeLabel(scope: McpScope, tScopes: TranslationFn): string {
  return tScopes(scope);
}

function getClientSource(context: McpOAuthAuthorizeContext): string {
  const source =
    context.client.clientUri ??
    context.client.metadataDocumentUri ??
    context.client.clientId;

  try {
    return new URL(source).hostname;
  } catch {
    return source;
  }
}

function getUrlOrUndefined(value: string): string | undefined {
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown, tRoot: TranslationFn): string {
  if (error instanceof McpOAuthAuthorizeError) {
    return error.message;
  }

  return tRoot("errors.api.UNKNOWN");
}
