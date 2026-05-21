CREATE TYPE "ObjectSequenceObjectType" AS ENUM ('REQUIREMENT', 'INTAKE_ITEM', 'TASK', 'BUG');

ALTER TABLE "requirements" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "intake_items" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "work_items" ADD COLUMN "sequence" INTEGER;

CREATE TABLE "object_sequence_counters" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "object_type" "ObjectSequenceObjectType" NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  CONSTRAINT "object_sequence_counters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "object_sequence_counters_next_value_check" CHECK ("next_value" > 0)
);

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "space_id"
      ORDER BY "created_at" ASC, "id" ASC
    )::INTEGER AS "sequence"
  FROM "requirements"
  WHERE "status" <> 'DRAFT'
)
UPDATE "requirements" AS "target"
SET "sequence" = "numbered"."sequence"
FROM "numbered"
WHERE "target"."id" = "numbered"."id";

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "space_id"
      ORDER BY "created_at" ASC, "id" ASC
    )::INTEGER AS "sequence"
  FROM "intake_items"
)
UPDATE "intake_items" AS "target"
SET "sequence" = "numbered"."sequence"
FROM "numbered"
WHERE "target"."id" = "numbered"."id";

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "space_id", "type"
      ORDER BY "created_at" ASC, "id" ASC
    )::INTEGER AS "sequence"
  FROM "work_items"
)
UPDATE "work_items" AS "target"
SET "sequence" = "numbered"."sequence"
FROM "numbered"
WHERE "target"."id" = "numbered"."id";

WITH maxima AS (
  SELECT
    "organization_id",
    "space_id",
    'REQUIREMENT'::"ObjectSequenceObjectType" AS "object_type",
    max("sequence") + 1 AS "next_value"
  FROM "requirements"
  WHERE "sequence" IS NOT NULL
  GROUP BY "organization_id", "space_id"

  UNION ALL

  SELECT
    "organization_id",
    "space_id",
    'INTAKE_ITEM'::"ObjectSequenceObjectType" AS "object_type",
    max("sequence") + 1 AS "next_value"
  FROM "intake_items"
  WHERE "sequence" IS NOT NULL
  GROUP BY "organization_id", "space_id"

  UNION ALL

  SELECT
    "organization_id",
    "space_id",
    CASE
      WHEN "type" = 'BUG' THEN 'BUG'::"ObjectSequenceObjectType"
      ELSE 'TASK'::"ObjectSequenceObjectType"
    END AS "object_type",
    max("sequence") + 1 AS "next_value"
  FROM "work_items"
  WHERE "sequence" IS NOT NULL
  GROUP BY "organization_id", "space_id", "type"
)
INSERT INTO "object_sequence_counters" (
  "id",
  "organization_id",
  "space_id",
  "object_type",
  "next_value",
  "created_at",
  "updated_at"
)
SELECT
  upper(substring(md5("space_id" || ':' || "object_type"::TEXT) from 1 for 26)),
  "organization_id",
  "space_id",
  "object_type",
  "next_value",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "maxima";

CREATE INDEX "object_sequence_counters_organization_id_idx" ON "object_sequence_counters"("organization_id");
CREATE INDEX "object_sequence_counters_space_id_idx" ON "object_sequence_counters"("space_id");
CREATE INDEX "object_sequence_counters_object_type_idx" ON "object_sequence_counters"("object_type");
CREATE INDEX "object_sequence_counters_created_by_id_idx" ON "object_sequence_counters"("created_by_id");
CREATE INDEX "object_sequence_counters_updated_by_id_idx" ON "object_sequence_counters"("updated_by_id");
CREATE UNIQUE INDEX "object_sequence_counters_space_object_type_key"
  ON "object_sequence_counters"("space_id", "object_type");

CREATE UNIQUE INDEX "requirements_space_sequence_key"
  ON "requirements"("space_id", "sequence")
  WHERE "sequence" IS NOT NULL;
CREATE UNIQUE INDEX "intake_items_space_sequence_key"
  ON "intake_items"("space_id", "sequence")
  WHERE "sequence" IS NOT NULL;
CREATE UNIQUE INDEX "work_items_space_type_sequence_key"
  ON "work_items"("space_id", "type", "sequence")
  WHERE "sequence" IS NOT NULL;

ALTER TABLE "object_sequence_counters" ADD CONSTRAINT "object_sequence_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_sequence_counters" ADD CONSTRAINT "object_sequence_counters_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_sequence_counters" ADD CONSTRAINT "object_sequence_counters_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "object_sequence_counters" ADD CONSTRAINT "object_sequence_counters_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
