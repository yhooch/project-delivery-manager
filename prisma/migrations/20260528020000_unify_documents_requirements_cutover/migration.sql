-- Cut over legacy requirements into documents and remove the legacy
-- requirements table from the runtime schema.

DO $$
DECLARE
  conflict_count INTEGER;
BEGIN
  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  JOIN "documents" d ON d."id" = r."id"
  WHERE d."kind" <> 'REQUIREMENT';

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % requirement ids already exist as non-REQUIREMENT documents', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  WHERE r."status" <> 'DRAFT'
    AND r."sequence" IS NULL;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % non-DRAFT requirements have no sequence', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  WHERE r."status" = 'DRAFT'
    AND r."sequence" IS NOT NULL;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % DRAFT requirements still have sequence values', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  JOIN "documents" d
    ON d."organization_id" = r."organization_id"
   AND d."space_id" = r."space_id"
   AND d."kind" = 'REQUIREMENT'
   AND d."sequence" = r."sequence"
   AND d."id" <> r."id"
  WHERE r."sequence" IS NOT NULL;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % requirement sequences already belong to different documents', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  JOIN "document_code_history" dch
    ON dch."organization_id" = r."organization_id"
   AND dch."space_id" = r."space_id"
   AND dch."kind" = 'REQUIREMENT'
   AND dch."sequence" = r."sequence"
   AND dch."document_id" <> r."id"
  WHERE r."sequence" IS NOT NULL;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % requirement codes already belong to different documents', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "intake_items" ii
  JOIN "documents" d ON d."id" = ii."requirement_id"
  WHERE ii."requirement_id" IS NOT NULL
    AND (
      d."kind" <> 'REQUIREMENT'
      OR d."status" <> 'ACTIVE'
      OR d."sequence" IS NULL
      OR d."deleted_at" IS NOT NULL
    );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot switch intake_items.requirement_id to documents: % rows point to invalid requirement documents', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "work_items" wi
  JOIN "documents" d ON d."id" = wi."requirement_id"
  WHERE wi."requirement_id" IS NOT NULL
    AND (
      d."kind" <> 'REQUIREMENT'
      OR d."status" <> 'ACTIVE'
      OR d."sequence" IS NULL
      OR d."deleted_at" IS NOT NULL
    );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot switch work_items.requirement_id to documents: % rows point to invalid requirement documents', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "intake_items" ii
  JOIN "requirements" r ON r."id" = ii."requirement_id"
  WHERE ii."requirement_id" IS NOT NULL
    AND (
      r."status" <> 'CONFIRMED'
      OR r."sequence" IS NULL
      OR r."deleted_at" IS NOT NULL
    );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot switch intake_items.requirement_id to documents: % rows point to draft, archived, unnumbered, or deleted requirements', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "work_items" wi
  JOIN "requirements" r ON r."id" = wi."requirement_id"
  WHERE wi."requirement_id" IS NOT NULL
    AND (
      r."status" <> 'CONFIRMED'
      OR r."sequence" IS NULL
      OR r."deleted_at" IS NOT NULL
    );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot switch work_items.requirement_id to documents: % rows point to draft, archived, unnumbered, or deleted requirements', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "workflow_bindings" wb
  WHERE wb."target_type" = 'REQUIREMENT';

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT target enum: % workflow_bindings rows still target REQUIREMENT', conflict_count;
  END IF;

  SELECT count(*)
    INTO conflict_count
  FROM "requirements" r
  JOIN "spaces" s ON s."id" = r."space_id"
  JOIN "organizations" o ON o."id" = r."organization_id"
  LEFT JOIN LATERAL (
    SELECT om."user_id"
    FROM "organization_members" om
    WHERE om."organization_id" = r."organization_id"
    ORDER BY
      CASE WHEN om."status" = 'ACTIVE' THEN 0 ELSE 1 END,
      om."created_at" ASC,
      om."id" ASC
    LIMIT 1
  ) migration_member ON TRUE
  WHERE COALESCE(
    r."author_id",
    r."owner_id",
    r."created_by_id",
    r."updated_by_id",
    s."owner_id",
    o."owner_id",
    migration_member."user_id"
  ) IS NULL;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate requirements to documents: % requirements have no available migration actor', conflict_count;
  END IF;
END $$;

WITH requirement_source AS (
  SELECT
    r.*,
    COALESCE(NULLIF(btrim(r."title"), ''), 'Untitled requirement') AS "document_title",
    CASE r."status"::TEXT
      WHEN 'DRAFT' THEN 'DRAFT'::"DocumentStatus"
      WHEN 'CONFIRMED' THEN 'ACTIVE'::"DocumentStatus"
      WHEN 'ARCHIVED' THEN 'ARCHIVED'::"DocumentStatus"
    END AS "document_status",
    COALESCE(
      r."author_id",
      r."owner_id",
      r."created_by_id",
      r."updated_by_id",
      s."owner_id",
      o."owner_id",
      migration_member."user_id"
    ) AS "migration_actor_id",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN 'MARKDOWN'::"ContentFormat"
      ELSE 'TIPTAP_JSON'::"ContentFormat"
    END AS "document_content_format",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN NULL
      ELSE COALESCE(r."content_json", '{}'::JSONB)
    END AS "document_content_json",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat"
        THEN COALESCE(r."content_markdown", r."content_markdown_cache", r."content_text", '')
      ELSE NULL
    END AS "document_content_markdown",
    COALESCE(
      r."content_text",
      CASE
        WHEN r."content_format" = 'MARKDOWN'::"ContentFormat"
          THEN COALESCE(r."content_markdown", r."content_markdown_cache")
        ELSE NULL
      END,
      r."content_markdown_cache",
      ''
    ) AS "document_content_text",
    COALESCE(
      r."content_markdown_cache",
      CASE
        WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN r."content_markdown"
        ELSE NULL
      END
    ) AS "document_content_markdown_cache"
  FROM "requirements" r
  JOIN "spaces" s ON s."id" = r."space_id"
  JOIN "organizations" o ON o."id" = r."organization_id"
  LEFT JOIN LATERAL (
    SELECT om."user_id"
    FROM "organization_members" om
    WHERE om."organization_id" = r."organization_id"
    ORDER BY
      CASE WHEN om."status" = 'ACTIVE' THEN 0 ELSE 1 END,
      om."created_at" ASC,
      om."id" ASC
    LIMIT 1
  ) migration_member ON TRUE
)
INSERT INTO "documents" (
  "id",
  "organization_id",
  "space_id",
  "kind",
  "title",
  "summary",
  "content_format",
  "content_json",
  "content_markdown",
  "content_text",
  "content_markdown_cache",
  "source_type",
  "status",
  "sequence",
  "version_id",
  "priority",
  "owner_id",
  "author_id",
  "revision",
  "created_via",
  "last_edited_by_id",
  "last_edited_via",
  "last_edited_at",
  "archived_at",
  "created_at",
  "updated_at",
  "created_by_id",
  "updated_by_id",
  "deleted_at"
)
SELECT
  rs."id",
  rs."organization_id",
  rs."space_id",
  'REQUIREMENT'::"DocumentKind",
  rs."document_title",
  rs."summary",
  rs."document_content_format",
  rs."document_content_json",
  rs."document_content_markdown",
  rs."document_content_text",
  rs."document_content_markdown_cache",
  'MIGRATED_REQUIREMENT'::"DocumentSourceType",
  rs."document_status",
  rs."sequence",
  rs."version_id",
  rs."priority",
  rs."owner_id",
  rs."author_id",
  1,
  'USER'::"DocumentActorType",
  rs."migration_actor_id",
  'USER'::"DocumentActorType",
  rs."updated_at",
  CASE
    WHEN rs."status" = 'ARCHIVED'
      THEN COALESCE(rs."updated_at", rs."created_at", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  rs."created_at",
  rs."updated_at",
  rs."created_by_id",
  rs."updated_by_id",
  rs."deleted_at"
FROM requirement_source rs
ON CONFLICT ("id") DO UPDATE SET
  "organization_id" = EXCLUDED."organization_id",
  "space_id" = EXCLUDED."space_id",
  "kind" = EXCLUDED."kind",
  "title" = EXCLUDED."title",
  "summary" = EXCLUDED."summary",
  "content_format" = EXCLUDED."content_format",
  "content_json" = EXCLUDED."content_json",
  "content_markdown" = EXCLUDED."content_markdown",
  "content_text" = EXCLUDED."content_text",
  "content_markdown_cache" = EXCLUDED."content_markdown_cache",
  "source_type" = EXCLUDED."source_type",
  "status" = EXCLUDED."status",
  "sequence" = EXCLUDED."sequence",
  "version_id" = EXCLUDED."version_id",
  "priority" = EXCLUDED."priority",
  "owner_id" = EXCLUDED."owner_id",
  "author_id" = EXCLUDED."author_id",
  "revision" = GREATEST("documents"."revision", EXCLUDED."revision"),
  "created_via" = EXCLUDED."created_via",
  "last_edited_by_id" = EXCLUDED."last_edited_by_id",
  "last_edited_via" = EXCLUDED."last_edited_via",
  "last_edited_at" = EXCLUDED."last_edited_at",
  "archived_at" = EXCLUDED."archived_at",
  "created_at" = EXCLUDED."created_at",
  "updated_at" = EXCLUDED."updated_at",
  "created_by_id" = EXCLUDED."created_by_id",
  "updated_by_id" = EXCLUDED."updated_by_id",
  "deleted_at" = EXCLUDED."deleted_at"
WHERE "documents"."kind" = 'REQUIREMENT';

WITH requirement_source AS (
  SELECT
    r.*,
    COALESCE(NULLIF(btrim(r."title"), ''), 'Untitled requirement') AS "document_title",
    COALESCE(
      r."author_id",
      r."owner_id",
      r."created_by_id",
      r."updated_by_id",
      s."owner_id",
      o."owner_id",
      migration_member."user_id"
    ) AS "migration_actor_id",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN 'MARKDOWN'::"ContentFormat"
      ELSE 'TIPTAP_JSON'::"ContentFormat"
    END AS "document_content_format",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN NULL
      ELSE COALESCE(r."content_json", '{}'::JSONB)
    END AS "document_content_json",
    CASE
      WHEN r."content_format" = 'MARKDOWN'::"ContentFormat"
        THEN COALESCE(r."content_markdown", r."content_markdown_cache", r."content_text", '')
      ELSE NULL
    END AS "document_content_markdown",
    COALESCE(
      r."content_text",
      CASE
        WHEN r."content_format" = 'MARKDOWN'::"ContentFormat"
          THEN COALESCE(r."content_markdown", r."content_markdown_cache")
        ELSE NULL
      END,
      r."content_markdown_cache",
      ''
    ) AS "document_content_text",
    COALESCE(
      r."content_markdown_cache",
      CASE
        WHEN r."content_format" = 'MARKDOWN'::"ContentFormat" THEN r."content_markdown"
        ELSE NULL
      END
    ) AS "document_content_markdown_cache"
  FROM "requirements" r
  JOIN "spaces" s ON s."id" = r."space_id"
  JOIN "organizations" o ON o."id" = r."organization_id"
  LEFT JOIN LATERAL (
    SELECT om."user_id"
    FROM "organization_members" om
    WHERE om."organization_id" = r."organization_id"
    ORDER BY
      CASE WHEN om."status" = 'ACTIVE' THEN 0 ELSE 1 END,
      om."created_at" ASC,
      om."id" ASC
    LIMIT 1
  ) migration_member ON TRUE
)
INSERT INTO "document_revisions" (
  "id",
  "organization_id",
  "space_id",
  "document_id",
  "revision",
  "kind",
  "title",
  "summary",
  "content_format",
  "content_json",
  "content_markdown",
  "content_text",
  "content_markdown_cache",
  "change_type",
  "actor_type",
  "actor_user_id",
  "request_id",
  "metadata",
  "created_at"
)
SELECT
  upper(substring(md5('document_revision:' || rs."id" || ':1') from 1 for 26)),
  rs."organization_id",
  rs."space_id",
  rs."id",
  1,
  'REQUIREMENT'::"DocumentKind",
  rs."document_title",
  rs."summary",
  rs."document_content_format",
  rs."document_content_json",
  rs."document_content_markdown",
  rs."document_content_text",
  rs."document_content_markdown_cache",
  'IMPORTED'::"DocumentChangeType",
  'USER'::"DocumentActorType",
  rs."migration_actor_id",
  'requirement-document-cutover',
  jsonb_build_object(
    'migratedFrom', 'requirements',
    'requirementId', rs."id",
    'requirementStatus', rs."status"::TEXT,
    'requirementSequence', rs."sequence"
  ),
  rs."created_at"
FROM requirement_source rs
ON CONFLICT ("document_id", "revision") DO UPDATE SET
  "organization_id" = EXCLUDED."organization_id",
  "space_id" = EXCLUDED."space_id",
  "kind" = EXCLUDED."kind",
  "title" = EXCLUDED."title",
  "summary" = EXCLUDED."summary",
  "content_format" = EXCLUDED."content_format",
  "content_json" = EXCLUDED."content_json",
  "content_markdown" = EXCLUDED."content_markdown",
  "content_text" = EXCLUDED."content_text",
  "content_markdown_cache" = EXCLUDED."content_markdown_cache",
  "change_type" = EXCLUDED."change_type",
  "actor_type" = EXCLUDED."actor_type",
  "actor_user_id" = EXCLUDED."actor_user_id",
  "request_id" = EXCLUDED."request_id",
  "metadata" = EXCLUDED."metadata",
  "created_at" = EXCLUDED."created_at";

WITH requirement_source AS (
  SELECT
    r.*,
    COALESCE(
      r."author_id",
      r."owner_id",
      r."created_by_id",
      r."updated_by_id",
      s."owner_id",
      o."owner_id",
      migration_member."user_id"
    ) AS "migration_actor_id"
  FROM "requirements" r
  JOIN "spaces" s ON s."id" = r."space_id"
  JOIN "organizations" o ON o."id" = r."organization_id"
  LEFT JOIN LATERAL (
    SELECT om."user_id"
    FROM "organization_members" om
    WHERE om."organization_id" = r."organization_id"
    ORDER BY
      CASE WHEN om."status" = 'ACTIVE' THEN 0 ELSE 1 END,
      om."created_at" ASC,
      om."id" ASC
    LIMIT 1
  ) migration_member ON TRUE
  WHERE r."sequence" IS NOT NULL
)
INSERT INTO "document_code_history" (
  "id",
  "organization_id",
  "space_id",
  "document_id",
  "kind",
  "code_prefix",
  "sequence",
  "display_code",
  "code_status",
  "assigned_at",
  "status_changed_at",
  "changed_by_id",
  "request_id",
  "reason",
  "created_at",
  "updated_at"
)
SELECT
  upper(substring(md5('document_code_history:' || rs."id" || ':' || rs."sequence"::TEXT) from 1 for 26)),
  rs."organization_id",
  rs."space_id",
  rs."id",
  'REQUIREMENT'::"DocumentKind",
  'REQ',
  rs."sequence",
  'REQ-' || rs."sequence"::TEXT,
  'ASSIGNED'::"DocumentCodeStatus",
  rs."created_at",
  rs."updated_at",
  rs."migration_actor_id",
  'requirement-document-cutover',
  'Migrated from requirements.sequence during document cutover',
  rs."created_at",
  rs."updated_at"
FROM requirement_source rs
ON CONFLICT ("organization_id", "document_id", "kind", "sequence") DO UPDATE SET
  "space_id" = EXCLUDED."space_id",
  "code_prefix" = EXCLUDED."code_prefix",
  "display_code" = EXCLUDED."display_code",
  "code_status" = EXCLUDED."code_status",
  "assigned_at" = EXCLUDED."assigned_at",
  "status_changed_at" = EXCLUDED."status_changed_at",
  "changed_by_id" = EXCLUDED."changed_by_id",
  "request_id" = EXCLUDED."request_id",
  "reason" = EXCLUDED."reason",
  "created_at" = EXCLUDED."created_at",
  "updated_at" = EXCLUDED."updated_at";

WITH desired_counters AS (
  SELECT
    dch."organization_id",
    dch."space_id",
    'REQUIREMENT'::"ObjectSequenceObjectType" AS "object_type",
    (COALESCE(max(dch."sequence"), 0) + 1)::INTEGER AS "next_value"
  FROM "document_code_history" dch
  WHERE dch."kind" = 'REQUIREMENT'
  GROUP BY dch."organization_id", dch."space_id"
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
  upper(substring(md5(dc."space_id" || ':' || dc."object_type"::TEXT) from 1 for 26)),
  dc."organization_id",
  dc."space_id",
  dc."object_type",
  dc."next_value",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM desired_counters dc
ON CONFLICT ("space_id", "object_type") DO UPDATE SET
  "organization_id" = EXCLUDED."organization_id",
  "next_value" = GREATEST("object_sequence_counters"."next_value", EXCLUDED."next_value"),
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "attachments" a
SET "target_type" = 'DOCUMENT'
WHERE a."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = a."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "comments" c
SET "target_type" = 'DOCUMENT'
WHERE c."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = c."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "timeline_events" te
SET "target_type" = 'DOCUMENT'
WHERE te."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = te."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "audit_logs" al
SET "target_type" = 'DOCUMENT'
WHERE al."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = al."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "timeline_events" te
SET "metadata" = jsonb_set(
  COALESCE(te."metadata", '{}'::JSONB),
  '{targetKind}',
  '"REQUIREMENT"'::JSONB,
  TRUE
)
WHERE te."target_type" = 'DOCUMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = te."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "timeline_events" te
SET "metadata" = jsonb_set(te."metadata", '{targetType}', '"DOCUMENT"'::JSONB, FALSE)
WHERE te."metadata"->>'targetType' = 'REQUIREMENT';

UPDATE "timeline_events" te
SET "metadata" = jsonb_set(
  jsonb_set(te."metadata", '{sourceTargetType}', '"DOCUMENT"'::JSONB, FALSE),
  '{sourceTargetKind}',
  '"REQUIREMENT"'::JSONB,
  TRUE
)
WHERE te."metadata"->>'sourceTargetType' = 'REQUIREMENT';

UPDATE "timeline_events" te
SET "metadata" = jsonb_set(
  jsonb_set(te."metadata", '{relatedTargetType}', '"DOCUMENT"'::JSONB, FALSE),
  '{relatedTargetKind}',
  '"REQUIREMENT"'::JSONB,
  TRUE
)
WHERE te."metadata"->>'relatedTargetType' = 'REQUIREMENT';

UPDATE "audit_logs" al
SET "metadata" = jsonb_set(
  COALESCE(al."metadata", '{}'::JSONB),
  '{targetKind}',
  '"REQUIREMENT"'::JSONB,
  TRUE
)
WHERE al."target_type" = 'DOCUMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = al."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "audit_logs" al
SET "metadata" = jsonb_set(al."metadata", '{targetType}', '"DOCUMENT"'::JSONB, FALSE)
WHERE al."metadata"->>'targetType' = 'REQUIREMENT';

UPDATE "intake_items" ii
SET "source_object" =
  (ii."source_object" - 'requirementId') || jsonb_build_object(
    'previousRequirementId', ii."source_object"->>'requirementId',
    'sourceDocumentKind', 'REQUIREMENT'
  )
WHERE ii."source_object" ? 'requirementId';

UPDATE "object_participants" op
SET "deleted_at" = COALESCE(op."deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE op."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = op."target_id"
      AND d."kind" = 'REQUIREMENT'
  )
  AND op."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "object_participants" existing
    WHERE existing."deleted_at" IS NULL
      AND existing."id" <> op."id"
      AND existing."space_id" = op."space_id"
      AND existing."target_type" = 'DOCUMENT'
      AND existing."target_id" = op."target_id"
      AND existing."user_id" = op."user_id"
      AND existing."relation_type" = op."relation_type"
  );

UPDATE "object_participants" op
SET "target_type" = 'DOCUMENT'
WHERE op."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = op."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "tag_assignments" ta
SET "deleted_at" = COALESCE(ta."deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE ta."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = ta."target_id"
      AND d."kind" = 'REQUIREMENT'
  )
  AND ta."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "tag_assignments" existing
    WHERE existing."deleted_at" IS NULL
      AND existing."id" <> ta."id"
      AND existing."space_id" = ta."space_id"
      AND existing."target_type" = 'DOCUMENT'
      AND existing."target_id" = ta."target_id"
      AND existing."tag_id" = ta."tag_id"
  );

UPDATE "tag_assignments" ta
SET "target_type" = 'DOCUMENT'
WHERE ta."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = ta."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "document_links" dl
SET "deleted_at" = COALESCE(dl."deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE dl."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = dl."target_id"
      AND d."kind" = 'REQUIREMENT'
  )
  AND dl."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "document_links" existing
    WHERE existing."deleted_at" IS NULL
      AND existing."id" <> dl."id"
      AND existing."document_id" = dl."document_id"
      AND existing."target_type" = 'DOCUMENT'
      AND existing."target_id" = dl."target_id"
  );

UPDATE "document_links" dl
SET "target_type" = 'DOCUMENT'
WHERE dl."target_type" = 'REQUIREMENT'
  AND EXISTS (
    SELECT 1
    FROM "documents" d
    WHERE d."id" = dl."target_id"
      AND d."kind" = 'REQUIREMENT'
  );

UPDATE "document_links" dl
SET "deleted_at" = COALESCE(dl."deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE dl."target_type" = 'DOCUMENT'
  AND dl."document_id" = dl."target_id"
  AND dl."deleted_at" IS NULL;

DO $$
DECLARE
  conflict_count INTEGER;
BEGIN
  SELECT count(*) INTO conflict_count FROM "attachments" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT attachment target enum: % attachments rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "comments" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT comment target enum: % comments rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "timeline_events" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT target enum: % timeline_events rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "object_participants" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT participant target enum: % object_participants rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "tag_assignments" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT tag target enum: % tag_assignments rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "document_links" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot remove REQUIREMENT document link target enum: % document_links rows remain', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count FROM "audit_logs" WHERE "target_type" = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot finish target cutover: % audit_logs rows still target REQUIREMENT', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count
  FROM "timeline_events"
  WHERE "metadata"->>'targetType' = 'REQUIREMENT'
     OR "metadata"->>'sourceTargetType' = 'REQUIREMENT'
     OR "metadata"->>'relatedTargetType' = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot finish target cutover: % timeline metadata rows still reference REQUIREMENT target type', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count
  FROM "audit_logs"
  WHERE "metadata"->>'targetType' = 'REQUIREMENT';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot finish target cutover: % audit metadata rows still reference REQUIREMENT target type', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count
  FROM "intake_items"
  WHERE "source_object" ? 'requirementId';
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot finish target cutover: % intake source_object rows still expose requirementId', conflict_count;
  END IF;

  SELECT count(*) INTO conflict_count
  FROM "document_links"
  WHERE "target_type" = 'DOCUMENT'
    AND "document_id" = "target_id"
    AND "deleted_at" IS NULL;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot finish target cutover: % active document self-links remain', conflict_count;
  END IF;
END $$;

CREATE TYPE "TargetType_new" AS ENUM ('SPACE', 'VERSION', 'DOCUMENT', 'INTAKE_ITEM', 'WORK_ITEM');
ALTER TABLE "workflow_bindings" ALTER COLUMN "target_type" DROP DEFAULT;
ALTER TABLE "workflow_bindings" ALTER COLUMN "target_type" TYPE "TargetType_new" USING "target_type"::text::"TargetType_new";
ALTER TABLE "timeline_events" ALTER COLUMN "target_type" TYPE "TargetType_new" USING "target_type"::text::"TargetType_new";
ALTER TYPE "TargetType" RENAME TO "TargetType_old";
ALTER TYPE "TargetType_new" RENAME TO "TargetType";
DROP TYPE "TargetType_old";
ALTER TABLE "workflow_bindings" ALTER COLUMN "target_type" SET DEFAULT 'WORK_ITEM'::"TargetType";

CREATE TYPE "AttachmentTargetType_new" AS ENUM ('WORK_ITEM', 'DOCUMENT');
ALTER TABLE "attachments" ALTER COLUMN "target_type" TYPE "AttachmentTargetType_new" USING "target_type"::text::"AttachmentTargetType_new";
ALTER TYPE "AttachmentTargetType" RENAME TO "AttachmentTargetType_old";
ALTER TYPE "AttachmentTargetType_new" RENAME TO "AttachmentTargetType";
DROP TYPE "AttachmentTargetType_old";

CREATE TYPE "CommentTargetType_new" AS ENUM ('INTAKE_ITEM', 'WORK_ITEM', 'DOCUMENT');
ALTER TABLE "comments" ALTER COLUMN "target_type" TYPE "CommentTargetType_new" USING "target_type"::text::"CommentTargetType_new";
ALTER TYPE "CommentTargetType" RENAME TO "CommentTargetType_old";
ALTER TYPE "CommentTargetType_new" RENAME TO "CommentTargetType";
DROP TYPE "CommentTargetType_old";

CREATE TYPE "ObjectParticipantTargetType_new" AS ENUM ('INTAKE_ITEM', 'WORK_ITEM', 'DOCUMENT');
ALTER TABLE "object_participants" ALTER COLUMN "target_type" TYPE "ObjectParticipantTargetType_new" USING "target_type"::text::"ObjectParticipantTargetType_new";
ALTER TYPE "ObjectParticipantTargetType" RENAME TO "ObjectParticipantTargetType_old";
ALTER TYPE "ObjectParticipantTargetType_new" RENAME TO "ObjectParticipantTargetType";
DROP TYPE "ObjectParticipantTargetType_old";

CREATE TYPE "TagTargetType_new" AS ENUM ('INTAKE_ITEM', 'WORK_ITEM', 'DOCUMENT');
ALTER TABLE "tag_assignments" ALTER COLUMN "target_type" TYPE "TagTargetType_new" USING "target_type"::text::"TagTargetType_new";
ALTER TYPE "TagTargetType" RENAME TO "TagTargetType_old";
ALTER TYPE "TagTargetType_new" RENAME TO "TagTargetType";
DROP TYPE "TagTargetType_old";

CREATE TYPE "DocumentLinkTargetType_new" AS ENUM ('DOCUMENT', 'VERSION', 'INTAKE_ITEM', 'WORK_ITEM');
ALTER TABLE "document_links" ALTER COLUMN "target_type" TYPE "DocumentLinkTargetType_new" USING "target_type"::text::"DocumentLinkTargetType_new";
ALTER TYPE "DocumentLinkTargetType" RENAME TO "DocumentLinkTargetType_old";
ALTER TYPE "DocumentLinkTargetType_new" RENAME TO "DocumentLinkTargetType";
DROP TYPE "DocumentLinkTargetType_old";

ALTER TABLE "intake_items" DROP CONSTRAINT IF EXISTS "intake_items_requirement_id_fkey";
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_items" DROP CONSTRAINT IF EXISTS "work_items_requirement_id_fkey";
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "requirements";
DROP TYPE "RequirementStatus";
