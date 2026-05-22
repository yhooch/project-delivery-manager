CREATE TYPE "SystemDataMigrationStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

CREATE TABLE "system_data_migrations" (
  "id" CHAR(26) NOT NULL,
  "migration_id" VARCHAR(160) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "status" "SystemDataMigrationStatus" NOT NULL DEFAULT 'PENDING',
  "applied_at" TIMESTAMPTZ(3),
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_data_migrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_data_migrations_migration_id_key" ON "system_data_migrations"("migration_id");
CREATE UNIQUE INDEX "system_data_migrations_id_checksum_key" ON "system_data_migrations"("migration_id", "checksum");
CREATE INDEX "system_data_migrations_status_idx" ON "system_data_migrations"("status");
CREATE INDEX "system_data_migrations_applied_at_idx" ON "system_data_migrations"("applied_at");
