import { SetMetadata } from "@nestjs/common";
import type { McpScope } from "@project-delivery/shared";

export const MCP_REQUIRED_SCOPES_METADATA = "mcp:required-scopes";

export function RequireMcpScopes(...scopes: McpScope[]) {
  return SetMetadata(MCP_REQUIRED_SCOPES_METADATA, scopes);
}
