"use client";

import type {
  CheckUpdateResponse,
  UpdateManifest,
  UpdaterJob,
  UpdaterJobStatus,
  UpdaterPhase,
  UpdaterStepStatus,
} from "@project-delivery/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  ListChecks,
  Loader2,
  Package,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Server,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { usePathname, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  checkUpdate,
  createUpdateJob,
  getUpdateJob,
  getUpdateStatus,
  rollbackUpdateJob,
} from "../../lib/upgrade-service";
import { cn } from "../../lib/utils";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { PageHeader } from "../v2/page-header";

const LAST_JOB_STORAGE_KEY = "project-delivery.upgrade.lastJobId";
const POLL_MS = 2500;
const TERMINAL_JOB_STATUSES = new Set<UpdaterJobStatus>([
  "succeeded",
  "failed",
  "rolled_back",
]);

export function UpgradeCenterPage() {
  const t = useTranslations("upgradeCenter");
  const tRoot = useTranslations();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof getUpdateStatus>> | null>(null);
  const [checkResult, setCheckResult] = useState<CheckUpdateResponse | null>(
    null,
  );
  const [job, setJob] = useState<UpdaterJob | null>(null);
  const [localJobId, setLocalJobId] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [creatingMode, setCreatingMode] = useState<"dryRun" | "apply" | null>(
    null,
  );
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const statusRequestSeq = useRef(0);
  const jobRequestSeq = useRef(0);

  const urlJobId = normalizeId(searchParams.get("jobId"));
  const targetJobId =
    status?.activeJobId ?? urlJobId ?? localJobId ?? status?.lastJobId ?? null;
  const manifest = checkResult?.manifest ?? job?.manifest ?? null;
  const isJobActive = Boolean(job && !TERMINAL_JOB_STATUSES.has(job.status));
  const canCreateFromManifest = Boolean(manifest && !isJobActive);
  const canRollback = Boolean(
    job?.rollback.supported &&
      job.rollback.status !== "running" &&
      job.status !== "rolled_back",
  );

  const setPersistedJobId = useCallback(
    (jobId: string | null) => {
      setLocalJobId(jobId);
      if (typeof window !== "undefined") {
        if (jobId) {
          window.localStorage.setItem(LAST_JOB_STORAGE_KEY, jobId);
        } else {
          window.localStorage.removeItem(LAST_JOB_STORAGE_KEY);
        }
      }

      const next = new URLSearchParams(searchParams.toString());
      if (jobId) {
        next.set("jobId", jobId);
      } else {
        next.delete("jobId");
      }
      const query = next.toString();
      router.replace((query ? `${pathname}?${query}` : pathname) as never, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const loadStatus = useCallback(
    async (showBlockingState = false) => {
      const requestId = statusRequestSeq.current + 1;
      statusRequestSeq.current = requestId;
      if (showBlockingState) {
        setIsLoadingStatus(true);
      }
      try {
        const next = await getUpdateStatus();
        if (statusRequestSeq.current !== requestId) return;
        setStatus(next);
        setErrorKey(null);
        if (next.activeJobId) {
          setPersistedJobId(next.activeJobId);
        }
      } catch (error) {
        if (statusRequestSeq.current === requestId) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (statusRequestSeq.current === requestId) {
          setIsLoadingStatus(false);
        }
      }
    },
    [setPersistedJobId],
  );

  const loadJob = useCallback(async (jobId: string) => {
    const requestId = jobRequestSeq.current + 1;
    jobRequestSeq.current = requestId;
    try {
      const next = await getUpdateJob(jobId);
      if (jobRequestSeq.current !== requestId) return;
      setJob(next);
      setErrorKey(null);
      if (TERMINAL_JOB_STATUSES.has(next.status)) {
        void loadStatus(false);
      }
    } catch (error) {
      if (jobRequestSeq.current === requestId) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    }
  }, [loadStatus]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLocalJobId(window.localStorage.getItem(LAST_JOB_STORAGE_KEY));
    }
    void loadStatus(true);
    return () => {
      statusRequestSeq.current += 1;
      jobRequestSeq.current += 1;
    };
  }, [loadStatus]);

  useEffect(() => {
    if (!targetJobId) {
      return;
    }

    void loadJob(targetJobId);
    const shouldPoll =
      !job || !TERMINAL_JOB_STATUSES.has(job.status) || status?.activeJobId;
    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadJob(targetJobId);
      void loadStatus(false);
    }, POLL_MS);

    return () => window.clearInterval(interval);
  }, [job, loadJob, loadStatus, status?.activeJobId, targetJobId]);

  const handleCheck = async () => {
    setIsChecking(true);
    setErrorKey(null);
    try {
      const result = await checkUpdate({
        ...(status?.channel ? { channel: status.channel } : {}),
        force: true,
      });
      setCheckResult(result);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsChecking(false);
    }
  };

  const handleCreateJob = async (dryRun: boolean) => {
    if (!manifest) return;
    setCreatingMode(dryRun ? "dryRun" : "apply");
    setErrorKey(null);
    try {
      const next = await createUpdateJob({ manifest, dryRun });
      setJob(next);
      setPersistedJobId(next.id);
      void loadStatus(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setCreatingMode(null);
    }
  };

  const handleRollback = async () => {
    if (!job) return;
    setIsRollingBack(true);
    setErrorKey(null);
    try {
      const next = await rollbackUpdateJob(job.id);
      setJob(next);
      setPersistedJobId(next.id);
      void loadStatus(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsRollingBack(false);
    }
  };

  const summaryItems = useMemo(
    () => [
      {
        label: t("summary.version"),
        value: status?.currentVersion ?? t("common.unknown"),
      },
      {
        label: t("summary.commit"),
        value: status?.currentCommit ?? t("common.unknown"),
        mono: true,
      },
      {
        label: t("summary.channel"),
        value: status?.channel ?? t("common.unknown"),
      },
      {
        label: t("summary.phase"),
        value: status?.phase ? t(`phase.${status.phase}`) : t("common.unknown"),
      },
      {
        label: t("summary.activeJob"),
        value: status?.activeJobId ?? targetJobId ?? t("common.none"),
        mono: Boolean(status?.activeJobId ?? targetJobId),
      },
      {
        label: t("summary.updatedAt"),
        value: formatDateTime(status?.updatedAt),
      },
    ],
    [status, t, targetJobId],
  );

  return (
    <div data-testid="upgrade-center-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={t("page.eyebrow")}
        title={t("page.title")}
        description={t("page.description")}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadStatus(true)}
              disabled={isLoadingStatus}
            >
              {isLoadingStatus ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {t("actions.refresh")}
            </Button>
            <Button type="button" onClick={() => void handleCheck()} disabled={isChecking}>
              {isChecking ? <Loader2 className="animate-spin" /> : <Package />}
              {t("actions.check")}
            </Button>
          </>
        }
        meta={
          status ? (
            <>
              <StatusPill value={status.phase} type="phase" />
              {status.activeJobId ? (
                <span className="font-mono text-[11px]">
                  {status.activeJobId}
                </span>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="flex-1 overflow-auto">
        {errorKey ? (
          <div
            role="alert"
            className="border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-sm text-destructive"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{tRoot(errorKey)}</span>
            </div>
          </div>
        ) : null}

        <section className="grid gap-px border-b border-border bg-border md:grid-cols-3 xl:grid-cols-6">
          {summaryItems.map((item) => (
            <MetricCell key={item.label} {...item} />
          ))}
        </section>

        <section className="border-b border-border px-6 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <CheckBadge result={checkResult} />
              {checkResult?.blockedReason ? (
                <Badge variant="destructive">
                  {t("labels.blocked")}:{" "}
                  {t(`errors.${checkResult.blockedReason}`)}
                </Badge>
              ) : null}
              {manifest ? <RiskBadge risk={manifest.riskLevel} /> : null}
              {manifest?.requiresMaintenance ? (
                <Badge variant="warning">{t("labels.maintenance")}</Badge>
              ) : null}
              {job ? (
                <span
                  className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
                  data-testid="upgrade-active-job-summary"
                >
                  <span className="font-mono text-[11px] text-foreground">
                    {job.id}
                  </span>
                  <JobBadge status={job.status} />
                  {job.steps.find((step) => step.status === "running")
                    ?.title ?? job.steps[0]?.title ?? null}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={confirmApply}
                  onChange={(event) => setConfirmApply(event.target.checked)}
                />
                {t("actions.confirmApply")}
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={!canCreateFromManifest || creatingMode !== null}
                onClick={() => void handleCreateJob(true)}
              >
                {creatingMode === "dryRun" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ListChecks />
                )}
                {t("actions.dryRun")}
              </Button>
              <Button
                type="button"
                disabled={
                  !canCreateFromManifest || !confirmApply || creatingMode !== null
                }
                onClick={() => void handleCreateJob(false)}
              >
                {creatingMode === "apply" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PlayCircle />
                )}
                {t("actions.apply")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canRollback || isRollingBack}
                onClick={() => void handleRollback()}
              >
                {isRollingBack ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {t("actions.rollback")}
              </Button>
            </div>
          </div>
        </section>

        {isLoadingStatus && !status ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("states.loading")}
          </div>
        ) : (
          <UpgradeTabs
            checkResult={checkResult}
            job={job}
            manifest={manifest}
          />
        )}
      </div>
    </div>
  );
}

function UpgradeTabs({
  checkResult,
  job,
  manifest,
}: {
  checkResult: CheckUpdateResponse | null;
  job: UpdaterJob | null;
  manifest: UpdateManifest | null;
}) {
  const t = useTranslations("upgradeCenter");

  return (
    <Tabs defaultValue="overview" className="px-6 py-4">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
        <TabsTrigger value="components">{t("tabs.components")}</TabsTrigger>
        <TabsTrigger value="progress">{t("tabs.progress")}</TabsTrigger>
        <TabsTrigger value="logs">{t("tabs.logs")}</TabsTrigger>
        <TabsTrigger value="rollback">{t("tabs.rollback")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
          <Section title={t("sections.release")}>
            {manifest ? (
              <DefinitionGrid
                items={[
                  [t("fields.version"), manifest.version],
                  [t("fields.commit"), manifest.commit, true],
                  [t("fields.channel"), manifest.channel],
                  [t("fields.publishedAt"), formatDateTime(manifest.publishedAt)],
                  [
                    t("fields.minUpgradeableVersion"),
                    manifest.minUpgradeableVersion,
                  ],
                  [t("fields.minUpdaterVersion"), manifest.minUpdaterVersion],
                  [t("fields.nginxConfigVersion"), manifest.nginx.configVersion],
                  [t("fields.maintenance"), t(`boolean.${String(manifest.requiresMaintenance)}`)],
                ]}
              />
            ) : (
              <EmptyLine text={t("states.noManifest")} />
            )}
          </Section>
          <Section title={t("sections.check")}>
            {checkResult ? (
              <DefinitionGrid
                items={[
                  [t("fields.checkStatus"), t(`checkStatus.${checkResult.status}`)],
                  [t("fields.currentVersion"), checkResult.currentVersion],
                  [t("fields.latestVersion"), checkResult.latestVersion ?? t("common.none")],
                  [t("fields.channel"), checkResult.channel],
                  [t("fields.checkedAt"), formatDateTime(checkResult.checkedAt)],
                  [
                    t("fields.blockedReason"),
                    checkResult.blockedReason
                      ? t(`errors.${checkResult.blockedReason}`)
                      : t("common.none"),
                  ],
                ]}
              />
            ) : (
              <EmptyLine text={t("states.noCheck")} />
            )}
          </Section>
        </div>
      </TabsContent>

      <TabsContent value="components">
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={t("sections.images")}>
            {manifest ? (
              <div className="grid gap-2">
                <ImageRow label="API" image={manifest.images.api.image} digest={manifest.images.api.digest} />
                <ImageRow label="Web" image={manifest.images.web.image} digest={manifest.images.web.digest} />
              </div>
            ) : (
              <EmptyLine text={t("states.noManifest")} />
            )}
          </Section>
          <Section title={t("sections.migrations")}>
            {manifest ? (
              <div className="grid gap-3">
                <MigrationList
                  title={t("fields.dbSchemaMigrations")}
                  items={manifest.dbSchemaMigrations}
                />
                <MigrationList
                  title={t("fields.systemDataMigrations")}
                  items={manifest.systemDataMigrations}
                />
              </div>
            ) : (
              <EmptyLine text={t("states.noManifest")} />
            )}
          </Section>
        </div>
      </TabsContent>

      <TabsContent value="progress">
        <Section title={t("sections.job")}>
          {job ? (
            <div className="grid gap-4">
              <DefinitionGrid
                items={[
                  [t("fields.jobId"), job.id, true],
                  [t("fields.jobStatus"), t(`jobStatus.${job.status}`)],
                  [t("fields.dryRun"), t(`boolean.${String(job.dryRun)}`)],
                  [t("fields.createdAt"), formatDateTime(job.createdAt)],
                  [t("fields.updatedAt"), formatDateTime(job.updatedAt)],
                  [t("fields.startedAt"), formatDateTime(job.startedAt)],
                  [t("fields.finishedAt"), formatDateTime(job.finishedAt)],
                  [t("fields.errorCode"), job.errorCode ? t(`errors.${job.errorCode}`) : t("common.none")],
                  [t("fields.errorMessage"), job.errorMessage ?? t("common.none")],
                ]}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-left text-xs">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{t("fields.step")}</th>
                      <th className="py-2 pr-3 font-medium">{t("fields.status")}</th>
                      <th className="py-2 pr-3 font-medium">{t("fields.startedAt")}</th>
                      <th className="py-2 pr-3 font-medium">{t("fields.finishedAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.steps.map((step) => (
                      <tr key={step.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 font-medium text-foreground">{step.title}</td>
                        <td className="py-2 pr-3"><StepBadge status={step.status} /></td>
                        <td className="py-2 pr-3 text-muted-foreground">{formatDateTime(step.startedAt)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{formatDateTime(step.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyLine text={t("states.noJob")} />
          )}
        </Section>
      </TabsContent>

      <TabsContent value="logs">
        <Section title={t("sections.logs")}>
          {job && job.steps.some((step) => step.logs.length > 0) ? (
            <div className="grid gap-2">
              {job.steps.flatMap((step) =>
                step.logs.map((log, index) => (
                  <div
                    key={`${step.id}-${index}`}
                    className="grid gap-1 border-b border-border/60 py-2 text-xs md:grid-cols-[9rem_6rem_minmax(0,1fr)]"
                  >
                    <span className="text-muted-foreground">{formatDateTime(log.at)}</span>
                    <Badge variant={log.level === "error" ? "destructive" : log.level === "warn" ? "warning" : "outline"}>
                      {log.level}
                    </Badge>
                    <span className="min-w-0 break-words font-mono text-[11px] text-foreground">
                      {step.title}: {log.message}
                    </span>
                  </div>
                )),
              )}
            </div>
          ) : (
            <EmptyLine text={t("states.noLogs")} />
          )}
        </Section>
      </TabsContent>

      <TabsContent value="rollback">
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={t("sections.rollback")}>
            {job ? (
              <DefinitionGrid
                items={[
                  [t("fields.rollbackSupported"), t(`boolean.${String(job.rollback.supported)}`)],
                  [t("fields.rollbackStatus"), t(`rollbackStatus.${job.rollback.status}`)],
                  [t("fields.targetVersion"), job.rollback.targetVersion ?? t("common.none")],
                  [t("fields.rollbackNotes"), job.rollback.notes ?? t("common.none")],
                ]}
              />
            ) : (
              <EmptyLine text={t("states.noJob")} />
            )}
          </Section>
          <Section title={t("sections.backups")}>
            {job && job.rollback.backups.length > 0 ? (
              <div className="grid gap-2">
                {job.rollback.backups.map((backup) => (
                  <div key={backup.id} className="grid gap-1 border-b border-border/60 pb-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{backup.kind}</span>
                      <span className="text-muted-foreground">{formatDateTime(backup.createdAt)}</span>
                    </div>
                    <span className="break-all font-mono text-[11px] text-muted-foreground">{backup.path}</span>
                    {backup.sha256 ? (
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{backup.sha256}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text={t("states.noBackups")} />
            )}
          </Section>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function MetricCell({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="min-w-0 bg-background px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-sm font-semibold text-foreground",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="min-w-0 border border-border bg-card">
      <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">
        {title}
      </h2>
      <div className="p-3">{children}</div>
    </section>
  );
}

function DefinitionGrid({
  items,
}: {
  items: Array<[string, string, boolean?]>;
}) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[12rem_minmax(0,1fr)]">
      {items.map(([label, value, mono]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd
            className={cn(
              "min-w-0 break-words text-foreground",
              mono && "truncate font-mono text-[11px]",
            )}
            title={value}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ImageRow({
  digest,
  image,
  label,
}: {
  digest: string;
  image: string;
  label: string;
}) {
  return (
    <div className="grid gap-1 border-b border-border/60 pb-2 text-xs sm:grid-cols-[4rem_minmax(0,1fr)]">
      <div className="flex items-center gap-1.5 font-medium">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-[11px]" title={image}>
          {image}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground" title={digest}>
          {digest}
        </div>
      </div>
    </div>
  );
}

function MigrationList({
  items,
  title,
}: {
  items: UpdateManifest["dbSchemaMigrations"];
  title: string;
}) {
  const t = useTranslations("upgradeCenter");
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        {title}
      </div>
      {items.length > 0 ? (
        <div className="grid gap-1">
          {items.map((item) => (
            <div key={item.id} className="grid gap-1 border-b border-border/60 py-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.id}</span>
                <Badge variant={item.required ? "warning" : "outline"}>
                  {item.kind}
                </Badge>
              </div>
              <span className="break-all font-mono text-[11px] text-muted-foreground">
                {item.path} · {item.sha256}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine text={t("states.none")} />
      )}
    </div>
  );
}

function CheckBadge({ result }: { result: CheckUpdateResponse | null }) {
  const t = useTranslations("upgradeCenter");
  if (!result) {
    return <Badge variant="outline">{t("states.noCheckShort")}</Badge>;
  }

  const variant: BadgeProps["variant"] =
    result.status === "available"
      ? "primary"
      : result.status === "blocked" || result.status === "failed"
        ? "destructive"
        : "success";
  return <Badge variant={variant}>{t(`checkStatus.${result.status}`)}</Badge>;
}

function RiskBadge({ risk }: { risk: UpdateManifest["riskLevel"] }) {
  const t = useTranslations("upgradeCenter");
  const variant: BadgeProps["variant"] =
    risk === "critical" || risk === "high"
      ? "destructive"
      : risk === "medium"
        ? "warning"
        : "success";
  return <Badge variant={variant}>{t(`risk.${risk}`)}</Badge>;
}

function StatusPill({
  type,
  value,
}: {
  type: "phase";
  value: UpdaterPhase;
}) {
  const t = useTranslations("upgradeCenter");
  const variant: BadgeProps["variant"] =
    value === "failed"
      ? "destructive"
      : value === "idle"
        ? "outline"
        : value === "rollback"
          ? "warning"
          : "primary";
  return <Badge variant={variant}>{t(`${type}.${value}`)}</Badge>;
}

function StepBadge({ status }: { status: UpdaterStepStatus }) {
  const t = useTranslations("upgradeCenter");
  const Icon =
    status === "succeeded"
      ? CheckCircle2
      : status === "failed"
        ? XCircle
        : status === "running"
          ? Loader2
          : Clock;
  const variant: BadgeProps["variant"] =
    status === "succeeded"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "running"
          ? "primary"
          : status === "skipped"
            ? "default"
            : "outline";
  return (
    <Badge variant={variant}>
      <Icon className={cn("h-3 w-3", status === "running" && "animate-spin")} />
      {t(`stepStatus.${status}`)}
    </Badge>
  );
}

function JobBadge({ status }: { status: UpdaterJobStatus }) {
  const t = useTranslations("upgradeCenter");
  const variant: BadgeProps["variant"] =
    status === "succeeded"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "rolled_back"
          ? "warning"
          : "primary";
  return <Badge variant={variant}>{t(`jobStatus.${status}`)}</Badge>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

function normalizeId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatDateTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
