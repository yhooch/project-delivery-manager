import type { McpScope } from "@project-delivery/shared";
import { z } from "zod";

export const MCP_SCOPE_VALUES = [
  "mcp:read",
  "mcp:write:requirement",
  "mcp:write:intake",
  "mcp:write:workitem",
  "mcp:write:bug",
  "mcp:write:comment",
  "mcp:write:document",
  "mcp:write:tag",
  "mcp:execute:workflow",
] as const satisfies readonly McpScope[];

export const McpScopeRuntimeSchema = z.enum(MCP_SCOPE_VALUES);
