CREATE TABLE "mcp_tool_invocations" (
  "id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "client_id" VARCHAR(200) NOT NULL,
  "tool_name" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(120) NOT NULL,
  "request_hash" VARCHAR(128) NOT NULL,
  "request_id" VARCHAR(128),
  "source" VARCHAR(32) NOT NULL DEFAULT 'MCP',
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "input_summary" JSONB NOT NULL,
  "result_status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "error_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mcp_tool_invocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_tool_invocations_idempotency_key"
  ON "mcp_tool_invocations"("user_id", "client_id", "tool_name", "idempotency_key");

CREATE INDEX "mcp_tool_invocations_organization_id_space_id_idx"
  ON "mcp_tool_invocations"("organization_id", "space_id");

CREATE INDEX "mcp_tool_invocations_request_id_idx"
  ON "mcp_tool_invocations"("request_id");

CREATE INDEX "mcp_tool_invocations_result_status_idx"
  ON "mcp_tool_invocations"("result_status");

CREATE INDEX "mcp_tool_invocations_created_at_idx"
  ON "mcp_tool_invocations"("created_at");
