CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "SessionRevocationReason" AS ENUM ('LOGOUT', 'ROTATED', 'EXPIRED', 'ADMIN');
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "Locale" AS ENUM ('zh_CN', 'en_US');
CREATE TYPE "ThemeMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

CREATE TABLE "users" (
  "id" CHAR(26) NOT NULL,
  "username" VARCHAR(32) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "avatar" VARCHAR(500),
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "locale" "Locale" NOT NULL DEFAULT 'zh_CN',
  "theme_mode" "ThemeMode" NOT NULL DEFAULT 'SYSTEM',
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revocation_reason" "SessionRevocationReason",
  "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_agent" VARCHAR(500),
  "ip" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organizations" (
  "id" CHAR(26) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "owner_id" CHAR(26),
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_members" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "role" "OrganizationRole" NOT NULL,
  "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_token_hash_idx" ON "sessions"("token_hash");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE INDEX "organizations_owner_id_idx" ON "organizations"("owner_id");
CREATE INDEX "organizations_code_idx" ON "organizations"("code");
CREATE UNIQUE INDEX "organizations_code_active_key" ON "organizations"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE UNIQUE INDEX "organization_members_organization_user_active_key" ON "organization_members"("organization_id", "user_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
