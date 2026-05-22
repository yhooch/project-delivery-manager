import { createHash, randomUUID } from "node:crypto";

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u;
const MIGRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type SystemDataMigrationStatus = "PENDING" | "APPLIED" | "FAILED";

export type SystemDataMigrationRecord = {
  id: string;
  migrationId: string;
  checksum: string;
  status: SystemDataMigrationStatus;
  appliedAt?: Date | string | null;
  errorMessage?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type SystemDataMigration = {
  id: string;
  checksum: string;
  execute: (executor: SystemDataMigrationExecutor) => Promise<void> | void;
};

export type SystemDataMigrationExecutor = {
  findRecord: (
    migrationId: string,
  ) =>
    | Promise<SystemDataMigrationRecord | null>
    | SystemDataMigrationRecord
    | null;
  createRecord: (
    record: SystemDataMigrationRecord,
  ) => Promise<SystemDataMigrationRecord> | SystemDataMigrationRecord;
  updateRecord: (
    migrationId: string,
    patch: Partial<SystemDataMigrationRecord>,
  ) => Promise<SystemDataMigrationRecord> | SystemDataMigrationRecord;
};

export type SystemDataMigrationPlanItem = {
  migrationId: string;
  checksum: string;
  action: "apply" | "skip" | "retry" | "block";
  reason?: string;
};

export type RunSystemDataMigrationsResult = {
  applied: string[];
  skipped: string[];
  retried: string[];
};

export class SystemDataMigrationError extends Error {
  constructor(
    readonly code:
      | "SYSTEM_DATA_MIGRATION_INVALID"
      | "SYSTEM_DATA_MIGRATION_DUPLICATE"
      | "SYSTEM_DATA_MIGRATION_CHECKSUM_DRIFT"
      | "SYSTEM_DATA_MIGRATION_FAILED",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SystemDataMigrationError";
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function planSystemDataMigrations(
  migrations: readonly Pick<SystemDataMigration, "id" | "checksum">[],
  records: readonly SystemDataMigrationRecord[],
): SystemDataMigrationPlanItem[] {
  validateMigrationList(migrations);
  const recordsByMigrationId = new Map(
    records.map((record) => [record.migrationId, record]),
  );

  return migrations.map((migration) => {
    const record = recordsByMigrationId.get(migration.id);

    if (!record) {
      return {
        migrationId: migration.id,
        checksum: migration.checksum,
        action: "apply",
      };
    }

    if (record.checksum !== migration.checksum) {
      return {
        migrationId: migration.id,
        checksum: migration.checksum,
        action: "block",
        reason: "checksum drift",
      };
    }

    if (record.status === "APPLIED") {
      return {
        migrationId: migration.id,
        checksum: migration.checksum,
        action: "skip",
        reason: "already applied",
      };
    }

    return {
      migrationId: migration.id,
      checksum: migration.checksum,
      action: record.status === "FAILED" ? "retry" : "apply",
      reason: record.status === "FAILED" ? "retry failed migration" : undefined,
    };
  });
}

export async function runSystemDataMigrations(
  migrations: readonly SystemDataMigration[],
  executor: SystemDataMigrationExecutor,
): Promise<RunSystemDataMigrationsResult> {
  validateMigrationList(migrations);
  const result: RunSystemDataMigrationsResult = {
    applied: [],
    skipped: [],
    retried: [],
  };

  for (const migration of migrations) {
    const existing = await executor.findRecord(migration.id);

    if (existing?.checksum && existing.checksum !== migration.checksum) {
      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_CHECKSUM_DRIFT",
        `system data migration checksum changed after first execution: ${migration.id}`,
        {
          migrationId: migration.id,
          expected: existing.checksum,
          actual: migration.checksum,
        },
      );
    }

    if (existing?.status === "APPLIED") {
      result.skipped.push(migration.id);
      continue;
    }

    const retried = existing?.status === "FAILED";
    const now = new Date();

    if (!existing) {
      await executor.createRecord({
        id: makeRecordId(),
        migrationId: migration.id,
        checksum: migration.checksum,
        status: "PENDING",
        appliedAt: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await executor.updateRecord(migration.id, {
        status: "PENDING",
        errorMessage: null,
        updatedAt: now,
      });
    }

    try {
      await migration.execute(executor);
      await executor.updateRecord(migration.id, {
        status: "APPLIED",
        appliedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await executor.updateRecord(migration.id, {
        status: "FAILED",
        errorMessage: message,
        updatedAt: new Date(),
      });

      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_FAILED",
        `system data migration failed: ${migration.id}`,
        { migrationId: migration.id, cause: message },
      );
    }

    if (retried) {
      result.retried.push(migration.id);
    } else {
      result.applied.push(migration.id);
    }
  }

  return result;
}

function validateMigrationList(
  migrations: readonly Pick<SystemDataMigration, "id" | "checksum">[],
): void {
  const seen = new Map<string, string>();

  for (const migration of migrations) {
    if (!MIGRATION_ID_PATTERN.test(migration.id)) {
      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_INVALID",
        `invalid system data migration id: ${migration.id}`,
      );
    }

    if (!CHECKSUM_PATTERN.test(migration.checksum)) {
      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_INVALID",
        `invalid system data migration checksum for ${migration.id}`,
      );
    }

    const priorChecksum = seen.get(migration.id);

    if (priorChecksum && priorChecksum !== migration.checksum) {
      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_DUPLICATE",
        `duplicate system data migration id with different checksum: ${migration.id}`,
      );
    }

    if (priorChecksum) {
      throw new SystemDataMigrationError(
        "SYSTEM_DATA_MIGRATION_DUPLICATE",
        `duplicate system data migration id: ${migration.id}`,
      );
    }

    seen.set(migration.id, migration.checksum);
  }
}

function makeRecordId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 26).toUpperCase();
}
