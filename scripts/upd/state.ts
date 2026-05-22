import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  type UpdateManifest,
  type UpdaterCommandPlanItem,
  type UpdaterJob,
  UpdaterJobSchema,
  type UpdaterRollbackMetadata,
  UpdaterRollbackMetadataSchema,
  type UpdaterStatus,
  UpdaterStatusSchema,
  type UpdaterStep,
  type UpdaterStepLog,
} from "../../packages/shared/src/update.ts";

export const DEFAULT_UPDATER_STATE_DIR = "/tmp/pdm-updater/state";

export type UpdaterStateStoreOptions = {
  stateDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

export class UpdaterStateStore {
  readonly stateDir: string;

  constructor(options: UpdaterStateStoreOptions = {}) {
    this.stateDir =
      options.stateDir ??
      options.env?.PDM_UPDATER_STATE_DIR ??
      options.env?.UPDATER_STATE_DIR ??
      process.env.PDM_UPDATER_STATE_DIR ??
      process.env.UPDATER_STATE_DIR ??
      DEFAULT_UPDATER_STATE_DIR;
  }

  async readStatus(): Promise<UpdaterStatus> {
    return readJson(this.statusPath(), UpdaterStatusSchema).catch(() =>
      UpdaterStatusSchema.parse({
        phase: "idle",
        updatedAt: nowIso(),
      }),
    );
  }

  async writeStatus(status: UpdaterStatus): Promise<UpdaterStatus> {
    const parsed = UpdaterStatusSchema.parse(status);
    await writeJsonAtomic(this.statusPath(), parsed);

    return parsed;
  }

  async readJob(jobId: string): Promise<UpdaterJob> {
    return readJson(this.jobPath(jobId), UpdaterJobSchema);
  }

  async writeJob(job: UpdaterJob): Promise<UpdaterJob> {
    const parsed = UpdaterJobSchema.parse(job);
    await writeJsonAtomic(this.jobPath(parsed.id), parsed);

    return parsed;
  }

  async createDryRunJob(
    manifest: UpdateManifest,
    commandPlan = buildDryRunCommandPlan(manifest),
  ): Promise<UpdaterJob> {
    const createdAt = nowIso();
    const job = UpdaterJobSchema.parse({
      id: `upd-${Date.now()}-${randomUUID()}`,
      dryRun: true,
      status: "queued",
      manifest,
      createdAt,
      updatedAt: createdAt,
      steps: buildDefaultSteps(),
      commandPlan,
      rollback: createRollbackSkeleton(manifest),
    });

    await this.writeJob(job);
    await this.writeStatus({
      phase: "preparing",
      activeJobId: job.id,
      lastJobId: job.id,
      channel: manifest.channel,
      updatedAt: createdAt,
    });

    return job;
  }

  async updateStep(
    jobId: string,
    stepId: string,
    patch: Partial<Omit<UpdaterStep, "id" | "logs">>,
  ): Promise<UpdaterJob> {
    const job = await this.readJob(jobId);
    const updatedAt = nowIso();

    return this.writeJob({
      ...job,
      updatedAt,
      steps: job.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              ...patch,
            }
          : step,
      ),
    });
  }

  async appendStepLog(
    jobId: string,
    stepId: string,
    log: Omit<UpdaterStepLog, "at"> & { at?: string },
  ): Promise<UpdaterJob> {
    const job = await this.readJob(jobId);
    const updatedAt = nowIso();
    const logEntry = {
      ...log,
      at: log.at ?? updatedAt,
    };

    return this.writeJob({
      ...job,
      updatedAt,
      steps: job.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              logs: [...step.logs, logEntry],
            }
          : step,
      ),
    });
  }

  async readRollback(): Promise<UpdaterRollbackMetadata> {
    return readJson(this.rollbackPath(), UpdaterRollbackMetadataSchema);
  }

  async writeRollback(
    rollback: UpdaterRollbackMetadata,
  ): Promise<UpdaterRollbackMetadata> {
    const parsed = UpdaterRollbackMetadataSchema.parse(rollback);
    await writeJsonAtomic(this.rollbackPath(), parsed);

    return parsed;
  }

  statusPath(): string {
    return path.join(this.stateDir, "status.json");
  }

  rollbackPath(): string {
    return path.join(this.stateDir, "rollback.json");
  }

  jobPath(jobId: string): string {
    return path.join(this.stateDir, "jobs", `${jobId}.json`);
  }
}

export function buildDryRunCommandPlan(
  manifest: UpdateManifest,
): UpdaterCommandPlanItem[] {
  return [
    {
      id: "validate-release",
      description: "Validate manifest, checksums, signature, and image digests",
      command: ["pdm-updater", "validate", manifest.version],
      requiresPrivilege: false,
    },
    {
      id: "backup-current",
      description: "Create database, env, compose, and nginx backup metadata",
      command: ["pdm-updater", "backup", "--dry-run"],
      requiresPrivilege: true,
    },
    {
      id: "pull-images",
      description: "Pull API and Web images by immutable digest",
      command: ["docker", "compose", "pull", "api", "web"],
      requiresPrivilege: true,
    },
    {
      id: "apply-migrations",
      description: "Apply DB schema and system data migrations",
      command: [
        "docker",
        "compose",
        "-p",
        "pdm-prod",
        "--env-file",
        ".env.prod",
        "-f",
        "docker-compose.prod.yml",
        "run",
        "--rm",
        "api",
        "corepack",
        "pnpm",
        "exec",
        "prisma",
        "migrate",
        "deploy",
        "--config",
        "prisma.config.ts",
      ],
      requiresPrivilege: true,
    },
    {
      id: "apply-system-data",
      description:
        "Apply idempotent system data migrations with checksum guard",
      command: [
        "pdm-updater",
        "system-data",
        "apply",
        "--manifest",
        manifest.version,
      ],
      requiresPrivilege: true,
    },
    {
      id: "stage-nginx",
      description: "Render and validate nginx template before activation",
      command: [
        "docker",
        "run",
        "--rm",
        "-v",
        "./deploy/nginx/staging:/etc/nginx/conf.d:ro",
        "nginx:1.27-alpine",
        "nginx",
        "-t",
      ],
      requiresPrivilege: true,
    },
  ];
}

export function createRollbackSkeleton(
  manifest: UpdateManifest,
): UpdaterRollbackMetadata {
  return UpdaterRollbackMetadataSchema.parse({
    supported: manifest.nginx.rollbackSupported,
    status: "not_started",
    targetVersion: manifest.minUpgradeableVersion,
    backups: [],
    notes: "Rollback metadata is persisted before privileged execution starts.",
  });
}

function buildDefaultSteps(): UpdaterStep[] {
  return [
    {
      id: "validate",
      title: "Validate release package",
      status: "pending",
      logs: [],
    },
    {
      id: "backup",
      title: "Persist backup metadata",
      status: "pending",
      logs: [],
    },
    {
      id: "plan",
      title: "Build command plan",
      status: "pending",
      logs: [],
    },
    {
      id: "rollback",
      title: "Prepare rollback metadata",
      status: "pending",
      logs: [],
    },
  ];
}

async function readJson<T>(
  filePath: string,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, filePath);
}

function nowIso(): string {
  return new Date().toISOString();
}
