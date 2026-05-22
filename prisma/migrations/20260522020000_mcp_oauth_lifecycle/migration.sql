CREATE TYPE "McpOAuthClientStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');
CREATE TYPE "McpOAuthClientRegistrationMode" AS ENUM ('PRE_REGISTERED', 'CLIENT_ID_METADATA_DOCUMENT');
CREATE TYPE "McpOAuthAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "McpOAuthTokenRevocationReason" AS ENUM ('ROTATED', 'REVOKED', 'AUTHORIZATION_REVOKED', 'EXPIRED');

CREATE TABLE "mcp_oauth_clients" (
  "id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "client_name" VARCHAR(120) NOT NULL,
  "client_uri" VARCHAR(500),
  "logo_uri" VARCHAR(500),
  "redirect_uris" TEXT[] NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "status" "McpOAuthClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "registration_mode" "McpOAuthClientRegistrationMode" NOT NULL,
  "metadata_document_uri" VARCHAR(500),
  "metadata_document_fetched_at" TIMESTAMPTZ(3),
  "metadata_document_expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorizations" (
  "id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "resource" VARCHAR(500) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "status" "McpOAuthAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "authorized_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mcp_oauth_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorization_codes" (
  "id" CHAR(26) NOT NULL,
  "code_hash" VARCHAR(128) NOT NULL,
  "authorization_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "redirect_uri" VARCHAR(500) NOT NULL,
  "resource" VARCHAR(500) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "code_challenge" VARCHAR(128) NOT NULL,
  "code_challenge_method" VARCHAR(16) NOT NULL DEFAULT 'S256',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_access_tokens" (
  "id" CHAR(26) NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "authorization_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "resource" VARCHAR(500) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" "McpOAuthTokenRevocationReason",
  "last_used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_refresh_tokens" (
  "id" CHAR(26) NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "authorization_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "resource" VARCHAR(500) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" "McpOAuthTokenRevocationReason",
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "mcp_oauth_clients"("client_id");
CREATE INDEX "mcp_oauth_clients_status_idx" ON "mcp_oauth_clients"("status");

CREATE UNIQUE INDEX "mcp_oauth_authorizations_user_id_client_id_resource_key" ON "mcp_oauth_authorizations"("user_id", "client_id", "resource");
CREATE INDEX "mcp_oauth_authorizations_user_id_status_idx" ON "mcp_oauth_authorizations"("user_id", "status");
CREATE INDEX "mcp_oauth_authorizations_client_id_idx" ON "mcp_oauth_authorizations"("client_id");

CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_code_hash_key" ON "mcp_oauth_authorization_codes"("code_hash");
CREATE INDEX "mcp_oauth_authorization_codes_authorization_id_idx" ON "mcp_oauth_authorization_codes"("authorization_id");
CREATE INDEX "mcp_oauth_authorization_codes_client_id_idx" ON "mcp_oauth_authorization_codes"("client_id");
CREATE INDEX "mcp_oauth_authorization_codes_expires_at_idx" ON "mcp_oauth_authorization_codes"("expires_at");

CREATE UNIQUE INDEX "mcp_oauth_access_tokens_token_hash_key" ON "mcp_oauth_access_tokens"("token_hash");
CREATE INDEX "mcp_oauth_access_tokens_authorization_id_idx" ON "mcp_oauth_access_tokens"("authorization_id");
CREATE INDEX "mcp_oauth_access_tokens_user_id_idx" ON "mcp_oauth_access_tokens"("user_id");
CREATE INDEX "mcp_oauth_access_tokens_client_id_idx" ON "mcp_oauth_access_tokens"("client_id");
CREATE INDEX "mcp_oauth_access_tokens_expires_at_idx" ON "mcp_oauth_access_tokens"("expires_at");

CREATE UNIQUE INDEX "mcp_oauth_refresh_tokens_token_hash_key" ON "mcp_oauth_refresh_tokens"("token_hash");
CREATE INDEX "mcp_oauth_refresh_tokens_authorization_id_idx" ON "mcp_oauth_refresh_tokens"("authorization_id");
CREATE INDEX "mcp_oauth_refresh_tokens_user_id_idx" ON "mcp_oauth_refresh_tokens"("user_id");
CREATE INDEX "mcp_oauth_refresh_tokens_client_id_idx" ON "mcp_oauth_refresh_tokens"("client_id");
CREATE INDEX "mcp_oauth_refresh_tokens_expires_at_idx" ON "mcp_oauth_refresh_tokens"("expires_at");

ALTER TABLE "mcp_oauth_authorizations" ADD CONSTRAINT "mcp_oauth_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorizations" ADD CONSTRAINT "mcp_oauth_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "mcp_oauth_authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "mcp_oauth_authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_tokens" ADD CONSTRAINT "mcp_oauth_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "mcp_oauth_authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
