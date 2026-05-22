ALTER TYPE "ContentFormat" ADD VALUE IF NOT EXISTS 'MARKDOWN';

ALTER TABLE "requirements"
  ADD COLUMN "content_markdown" TEXT;
