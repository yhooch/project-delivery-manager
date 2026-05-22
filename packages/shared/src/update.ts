import { z } from "zod";

import { EmptyObjectSchema, IsoDateTimeSchema } from "./common.ts";

export const UpdateErrorCodeSchema = z.enum([
  "UPDATE_ACCESS_DENIED",
  "PLATFORM_OPERATOR_REQUIRED",
  "UPDATE_MANIFEST_INVALID",
  "UPDATE_CHECKSUM_MISMATCH",
  "UPDATE_SIGNATURE_INVALID",
  "UPDATE_UPDATER_TOO_OLD",
  "UPDATE_VERSION_INCOMPATIBLE",
  "UPDATE_DIGEST_MISMATCH",
  "UPDATE_PACKAGE_SECRET_DETECTED",
  "UPDATE_PROVIDER_UNAVAILABLE",
  "UPDATE_JOB_NOT_FOUND",
  "UPDATE_JOB_CONFLICT",
]);

export type UpdateErrorCode = z.infer<typeof UpdateErrorCodeSchema>;

export const UpdateRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export type UpdateRiskLevel = z.infer<typeof UpdateRiskLevelSchema>;

export const UpdateSha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "Expected a lowercase sha256 hex digest");

export const UpdateImageDigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "Expected sha256:<64 lowercase hex>");

export const UpdateRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.split(/[\\/]/u).includes(".."),
    {
      message: "Expected a package-relative path",
    },
  );

export const UpdateImageRefSchema = z
  .object({
    image: z.string().min(1),
    digest: UpdateImageDigestSchema,
  })
  .strict();

export type UpdateImageRef = z.infer<typeof UpdateImageRefSchema>;

export const UpdateMigrationKindSchema = z.enum(["prisma", "sql", "script"]);

export const UpdateMigrationRefSchema = z
  .object({
    id: z.string().min(1),
    path: UpdateRelativePathSchema,
    sha256: UpdateSha256HexSchema,
    kind: UpdateMigrationKindSchema,
    required: z.boolean().default(true),
  })
  .strict();

export type UpdateMigrationRef = z.infer<typeof UpdateMigrationRefSchema>;

export const UpdateNginxReleaseBlockSchema = z
  .object({
    configVersion: z.string().min(1),
    templatePath: UpdateRelativePathSchema,
    sha256: UpdateSha256HexSchema,
    requiredVariables: z.array(z.string().min(1)).default([]),
    rollbackSupported: z.boolean(),
  })
  .strict();

export type UpdateNginxReleaseBlock = z.infer<
  typeof UpdateNginxReleaseBlockSchema
>;

export const UpdateManifestSchema = z
  .object({
    manifestSchemaVersion: z.literal(1),
    version: z.string().min(1),
    commit: z.string().min(1),
    channel: z.string().min(1),
    publishedAt: IsoDateTimeSchema,
    minUpgradeableVersion: z.string().min(1),
    minUpdaterVersion: z.string().min(1),
    requiresMaintenance: z.boolean(),
    riskLevel: UpdateRiskLevelSchema,
    images: z
      .object({
        api: UpdateImageRefSchema,
        web: UpdateImageRefSchema,
      })
      .strict(),
    dbSchemaMigrations: z.array(UpdateMigrationRefSchema).default([]),
    systemDataMigrations: z.array(UpdateMigrationRefSchema).default([]),
    nginx: UpdateNginxReleaseBlockSchema,
    checksums: z.record(UpdateRelativePathSchema, UpdateSha256HexSchema),
  })
  .strict();

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export const UpdateCheckStatusSchema = z.enum([
  "current",
  "available",
  "blocked",
  "failed",
]);

export type UpdateCheckStatus = z.infer<typeof UpdateCheckStatusSchema>;

export const UpdateCheckResultSchema = z
  .object({
    status: UpdateCheckStatusSchema,
    channel: z.string().min(1),
    currentVersion: z.string().min(1),
    latestVersion: z.string().min(1).optional(),
    manifest: UpdateManifestSchema.optional(),
    blockedReason: UpdateErrorCodeSchema.optional(),
    checkedAt: IsoDateTimeSchema,
  })
  .strict();

export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;

export const UpdaterPhaseSchema = z.enum([
  "idle",
  "checking",
  "preparing",
  "applying",
  "verifying",
  "rollback",
  "failed",
]);

export type UpdaterPhase = z.infer<typeof UpdaterPhaseSchema>;

export const UpdaterJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "rolled_back",
]);

export type UpdaterJobStatus = z.infer<typeof UpdaterJobStatusSchema>;

export const UpdaterStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export type UpdaterStepStatus = z.infer<typeof UpdaterStepStatusSchema>;

export const UpdaterCommandPlanItemSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    command: z.array(z.string().min(1)).min(1),
    requiresPrivilege: z.boolean(),
  })
  .strict();

export type UpdaterCommandPlanItem = z.infer<
  typeof UpdaterCommandPlanItemSchema
>;

export const UpdaterStepLogSchema = z
  .object({
    at: IsoDateTimeSchema,
    level: z.enum(["info", "warn", "error"]),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

export type UpdaterStepLog = z.infer<typeof UpdaterStepLogSchema>;

export const UpdaterStepSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: UpdaterStepStatusSchema,
    startedAt: IsoDateTimeSchema.optional(),
    finishedAt: IsoDateTimeSchema.optional(),
    logs: z.array(UpdaterStepLogSchema).default([]),
  })
  .strict();

export type UpdaterStep = z.infer<typeof UpdaterStepSchema>;

export const UpdaterBackupMetadataSchema = z
  .object({
    id: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    kind: z.enum(["database", "files", "nginx", "compose", "env"]),
    path: z.string().min(1),
    sha256: UpdateSha256HexSchema.optional(),
  })
  .strict();

export type UpdaterBackupMetadata = z.infer<typeof UpdaterBackupMetadataSchema>;

export const UpdaterRollbackMetadataSchema = z
  .object({
    supported: z.boolean(),
    status: z
      .enum(["not_started", "ready", "running", "succeeded", "failed"])
      .default("not_started"),
    targetVersion: z.string().min(1).optional(),
    backups: z.array(UpdaterBackupMetadataSchema).default([]),
    notes: z.string().min(1).optional(),
  })
  .strict();

export type UpdaterRollbackMetadata = z.infer<
  typeof UpdaterRollbackMetadataSchema
>;

export const UpdaterJobSchema = z
  .object({
    id: z.string().min(1),
    dryRun: z.boolean(),
    status: UpdaterJobStatusSchema,
    manifest: UpdateManifestSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    finishedAt: IsoDateTimeSchema.optional(),
    steps: z.array(UpdaterStepSchema),
    commandPlan: z.array(UpdaterCommandPlanItemSchema),
    rollback: UpdaterRollbackMetadataSchema,
    errorCode: UpdateErrorCodeSchema.optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict();

export type UpdaterJob = z.infer<typeof UpdaterJobSchema>;

export const UpdaterStatusSchema = z
  .object({
    phase: UpdaterPhaseSchema,
    currentVersion: z.string().min(1).optional(),
    currentCommit: z.string().min(1).optional(),
    channel: z.string().min(1).optional(),
    activeJobId: z.string().min(1).optional(),
    lastJobId: z.string().min(1).optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type UpdaterStatus = z.infer<typeof UpdaterStatusSchema>;

export const UpdateJobIdPathParamsSchema = z
  .object({
    jobId: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._:-]+$/u, "Expected an updater job id"),
  })
  .strict();

export type UpdateJobIdPathParams = z.infer<
  typeof UpdateJobIdPathParamsSchema
>;

export const GetUpdateStatusResponseSchema = UpdaterStatusSchema;
export type GetUpdateStatusResponse = z.infer<
  typeof GetUpdateStatusResponseSchema
>;

export const CheckUpdateRequestSchema = z
  .object({
    channel: z.string().min(1).optional(),
    force: z.boolean().default(false),
  })
  .strict();

export type CheckUpdateRequest = z.infer<typeof CheckUpdateRequestSchema>;

export const CheckUpdateResponseSchema = UpdateCheckResultSchema;
export type CheckUpdateResponse = z.infer<typeof CheckUpdateResponseSchema>;

export const CreateUpdateJobRequestSchema = z
  .object({
    manifest: UpdateManifestSchema,
    dryRun: z.boolean().default(false),
  })
  .strict();

export type CreateUpdateJobRequest = z.infer<
  typeof CreateUpdateJobRequestSchema
>;

export const CreateUpdateJobResponseSchema = UpdaterJobSchema;
export type CreateUpdateJobResponse = z.infer<
  typeof CreateUpdateJobResponseSchema
>;

export const GetUpdateJobResponseSchema = UpdaterJobSchema;
export type GetUpdateJobResponse = z.infer<typeof GetUpdateJobResponseSchema>;

export const RollbackUpdateJobRequestSchema = EmptyObjectSchema;
export type RollbackUpdateJobRequest = z.infer<
  typeof RollbackUpdateJobRequestSchema
>;

export const RollbackUpdateJobResponseSchema = UpdaterJobSchema;
export type RollbackUpdateJobResponse = z.infer<
  typeof RollbackUpdateJobResponseSchema
>;
