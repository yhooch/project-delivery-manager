import { describe, expect, it } from "vitest";

import {
  ApiErrorCodeSchema,
  McpBearerChallengeSchema,
  McpCanonicalResourceUriSchema,
  McpCreateRequirementRequestSchema,
  McpCreateDocumentFromMarkdownRequestSchema,
  McpContextSchema,
  McpDryRunResultSchema,
  McpEndpointPolicy,
  McpEndpointPolicySchema,
  McpIdempotencyConflictDetailsSchema,
  McpIdempotencyScopeSchema,
  McpJsonRpcErrorResponseSchema,
  McpOAuthAuthorizeQuerySchema,
  McpOAuthDynamicClientRegistrationRequestSchema,
  McpOAuthDynamicClientRegistrationResponseSchema,
  McpOAuthClientMetadataDocumentSchema,
  McpOAuthRedirectUriSchema,
  McpOAuthTokenResponseSchema,
  McpProtectedResourceMetadataPath,
  McpProtectedResourceMetadataSchema,
  McpScopeSchema,
  McpToolErrorResultSchema,
  McpToolNameSchema,
  McpToolRegistrySchema,
  McpToolsCallRequestSchema,
  McpToolsListResultSchema,
  apiContracts,
  generateOpenApiDocument,
  mcpToolContracts,
  mcpToolRegistry,
} from "./index.ts";

const organizationId = "01BRZ3NDEKTSV4RRFFQ69G5FAA";
const spaceId = "01DRZ3NDEKTSV4RRFFQ69G5FAC";
const resource = "https://pdm.example.com/api/v1/mcp";

describe("MCP and OAuth shared contracts", () => {
  it("freezes MCP scopes, resource URI and Bearer challenge details", () => {
    expect(McpScopeSchema.options).toEqual([
      "mcp:read",
      "mcp:write:requirement",
      "mcp:write:intake",
      "mcp:write:workitem",
      "mcp:write:bug",
      "mcp:write:comment",
      "mcp:write:document",
      "mcp:write:tag",
      "mcp:execute:workflow",
    ]);
    expect(ApiErrorCodeSchema.options).toEqual(
      expect.arrayContaining([
        "MCP_UNAUTHORIZED",
        "MCP_INSUFFICIENT_SCOPE",
        "MCP_TOOL_NOT_FOUND",
        "MCP_TOOL_ARGUMENT_INVALID",
        "MCP_IDEMPOTENCY_CONFLICT",
        "MCP_CLIENT_NOT_FOUND",
        "MCP_CONSENT_REQUIRED",
        "MCP_CONSENT_REVOKED",
      ]),
    );
    expect(McpCanonicalResourceUriSchema.parse(resource)).toBe(resource);
    expect(
      McpCanonicalResourceUriSchema.safeParse(`${resource}#fragment`).success,
    ).toBe(false);
    expect(
      McpBearerChallengeSchema.parse({
        scheme: "Bearer",
        resource_metadata: `https://pdm.example.com${McpProtectedResourceMetadataPath}`,
        resource,
        scope: "mcp:write:tag",
        error: "insufficient_scope",
      }),
    ).toMatchObject({
      error: "insufficient_scope",
      scope: "mcp:write:tag",
    });
  });

  it("freezes OAuth discovery, PKCE and authorized client metadata boundaries", () => {
    expect(McpOAuthRedirectUriSchema.parse("http://localhost:3000/callback")).toBe(
      "http://localhost:3000/callback",
    );
    expect(
      McpOAuthRedirectUriSchema.safeParse("http://agent.example.com/callback")
        .success,
    ).toBe(false);

    expect(
      McpProtectedResourceMetadataSchema.parse({
        resource,
        authorization_servers: ["https://pdm.example.com"],
        scopes_supported: ["mcp:read", "mcp:write:requirement"],
      }),
    ).toMatchObject({
      resource,
      bearer_methods_supported: ["header"],
    });
    expect(
      McpOAuthAuthorizeQuerySchema.parse({
        response_type: "code",
        client_id: "claude-desktop",
        redirect_uri: "http://localhost:3000/callback",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        scope: "mcp:read mcp:write:requirement",
        resource,
      }),
    ).toMatchObject({
      code_challenge_method: "S256",
      resource,
    });
    expect(
      McpOAuthClientMetadataDocumentSchema.parse({
        client_id: "https://agent.example.com/client.json",
        client_name: "Agent",
        redirect_uris: ["https://agent.example.com/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp:read",
      }),
    ).toMatchObject({
      client_name: "Agent",
    });
    expect(
      McpOAuthDynamicClientRegistrationRequestSchema.parse({
        redirect_uris: ["http://localhost:4555/callback"],
        client_name: "Codex CLI",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "mcp:read",
        token_endpoint_auth_method: "none",
        contacts: ["dev@example.com"],
      }),
    ).toMatchObject({
      client_name: "Codex CLI",
    });
    expect(
      McpOAuthDynamicClientRegistrationResponseSchema.parse({
        client_id: "mcp_dcr_01HX0000000000000000000000",
        client_id_issued_at: 1_779_436_800,
        client_name: "Codex CLI",
        redirect_uris: ["http://localhost:4555/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp:read",
        token_endpoint_auth_method: "none",
      }),
    ).toMatchObject({
      token_endpoint_auth_method: "none",
    });
    expect(
      McpOAuthTokenResponseSchema.parse({
        access_token: "opaque-access-token",
        refresh_token: "opaque-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "mcp:read",
      }),
    ).toMatchObject({
      token_type: "Bearer",
    });
  });

  it("freezes the first-phase stateless Streamable HTTP endpoint policy", () => {
    expect(McpEndpointPolicySchema.parse(McpEndpointPolicy)).toMatchObject({
      path: "/api/v1/mcp",
      transport: "STREAMABLE_HTTP",
      post: {
        responseWrapped: false,
      },
      auth: {
        authorizationHeaderScheme: "Bearer",
        queryTokenAccepted: false,
        webCookieAccepted: false,
      },
      protocol: {
        supportedVersions: ["2025-06-18", "2025-11-25"],
        protocolVersionHeaderName: "MCP-Protocol-Version",
        requireProtocolVersionAfterInitialize: true,
        unsupportedProtocolVersionStatus: 400,
      },
      session: {
        firstPhaseMode: "STATELESS_NO_MCP_SESSION_ID",
        issueSessionIdHeader: false,
        requireSessionIdHeader: false,
      },
      capabilities: {
        tools: true,
        resources: false,
        prompts: false,
      },
    });
  });

  it("freezes tools/list registry schemas, scopes and annotations", () => {
    expect(McpToolRegistrySchema.parse(mcpToolRegistry)).toHaveLength(26);
    expect(mcpToolContracts).toHaveLength(McpToolNameSchema.options.length);
    expect(new Set(mcpToolRegistry.map((tool) => tool.name)).size).toBe(
      mcpToolRegistry.length,
    );

    for (const tool of mcpToolRegistry) {
      expect(tool.inputSchema).toHaveProperty("type");
      expect(Object.keys(tool.outputSchema).length).toBeGreaterThan(0);
      expect(tool.scopes.length).toBeGreaterThan(0);
    }

    const writeTools = mcpToolRegistry.filter(
      (tool) => !tool.annotations.readOnlyHint,
    );
    expect(writeTools.map((tool) => tool.name)).toEqual([
      "pdm.requirement.create",
      "pdm.intake.create",
      "pdm.work_item.create_task",
      "pdm.work_item.update",
      "pdm.work_item.execute_action",
      "pdm.bug.create",
      "pdm.comment.create",
      "pdm.document.create_from_markdown",
      "pdm.document.append_content",
      "pdm.document.replace_content",
      "pdm.document.update_metadata",
      "pdm.document.link_resources",
      "pdm.tag.replace_assignments",
    ]);

    for (const tool of writeTools) {
      expect(tool.annotations.idempotentHint).toBe(true);
      expect(tool.annotations.openWorldHint).toBe(false);
      expect(tool.inputSchema).toMatchObject({
        required: expect.arrayContaining([
          "organizationId",
          "spaceId",
          "idempotencyKey",
        ]),
        properties: expect.objectContaining({
          targetSelectionSource: expect.any(Object),
        }),
      });
    }

    expect(
      mcpToolRegistry.find((tool) => tool.name === "pdm.work_item.update")
        ?.annotations.destructiveHint,
    ).toBe(true);
    expect(
      mcpToolRegistry.find((tool) => tool.name === "pdm.context.get")
        ?.annotations.readOnlyHint,
    ).toBe(true);
    expect(
      mcpToolRegistry.find((tool) => tool.name === "pdm.document.search")
        ?.scopes,
    ).toEqual(["mcp:read"]);
    expect(
      mcpToolRegistry.find((tool) => tool.name === "pdm.document.append_content")
        ?.inputSchema,
    ).toMatchObject({
      required: expect.arrayContaining(["baseRevision", "documentId"]),
    });
    expect(
      mcpToolRegistry.find(
        (tool) => tool.name === "pdm.document.link_resources",
      )?.inputSchema,
    ).toMatchObject({
      required: expect.arrayContaining(["baseRevision", "documentId"]),
    });
    expect(
      mcpToolRegistry.find((tool) => tool.name === "pdm.comment.create")
        ?.description,
    ).toContain("document");
    expect(
      McpToolsListResultSchema.parse({
        tools: mcpToolRegistry,
      }).tools[0],
    ).toMatchObject({
      name: "pdm.context.get",
      scopes: ["mcp:read"],
    });
  });

  it("requires write context for MCP Markdown requirement creation", () => {
    const input = {
      organizationId,
      spaceId,
      idempotencyKey: "req-create-2026-05-22",
      targetSelectionSource: "USER_EXPLICIT",
      dryRun: true,
      title: "Create MCP contract",
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Contract\n\nFreeze MCP shared schemas.",
      priority: "HIGH",
      tagIds: ["01VRZ3NDEKTSV4RRFFQ69G5FAV"],
    };

    expect(McpCreateRequirementRequestSchema.parse(input)).toMatchObject({
      contentFormat: "MARKDOWN",
      dryRun: true,
      organizationId,
      spaceId,
      targetSelectionSource: "USER_EXPLICIT",
    });
    expect(
      McpCreateRequirementRequestSchema.safeParse({
        ...input,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires write context for MCP Markdown document creation", () => {
    const input = {
      organizationId,
      spaceId,
      idempotencyKey: "doc-create-2026-05-27",
      targetSelectionSource: "USER_EXPLICIT",
      dryRun: true,
      title: "Agent handoff",
      contentMarkdown: "# Agent handoff\n\nNext steps.",
      tagIds: ["01VRZ3NDEKTSV4RRFFQ69G5FAV"],
    };

    expect(McpCreateDocumentFromMarkdownRequestSchema.parse(input)).toMatchObject({
      contentMarkdown: "# Agent handoff\n\nNext steps.",
      dryRun: true,
      organizationId,
      spaceId,
      targetSelectionSource: "USER_EXPLICIT",
    });
    expect(
      McpCreateDocumentFromMarkdownRequestSchema.safeParse({
        ...input,
        sourceType: "PASTE_MARKDOWN",
      }).success,
    ).toBe(false);
  });

  it("allows dryRun result content for first-phase write tool outputs", () => {
    const dryRunResult = McpDryRunResultSchema.parse({
      canWrite: true,
      committed: false,
      dryRun: true,
      message: "Input schema and space context validated.",
      organizationId,
      requiresConfirmation: false,
      spaceId,
      targetSelectionSource: "USER_EXPLICIT",
      toolName: "pdm.requirement.create",
      validated: ["inputSchema", "spaceContext"],
    });
    const createRequirement = mcpToolContracts.find(
      (tool) => tool.name === "pdm.requirement.create",
    );

    expect(createRequirement?.outputSchema.parse(dryRunResult)).toMatchObject({
      committed: false,
      dryRun: true,
    });
  });

  it("separates MCP context suggestions from write targets", () => {
    const context = McpContextSchema.parse({
      user: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        username: "agent",
        name: "Agent User",
        status: "ACTIVE",
        preferences: {
          locale: "zh-CN",
          themeMode: "SYSTEM",
        },
      },
      organizations: [
        {
          id: organizationId,
          name: "Org",
          code: "org",
          role: "OWNER",
          status: "ACTIVE",
        },
      ],
      spaces: [
        {
          id: spaceId,
          name: "Space",
          code: "space",
          organizationId,
          role: "PM",
          status: "ACTIVE",
        },
      ],
      readSuggestedOrganizationId: organizationId,
      readSuggestedSpaceId: spaceId,
      writableSpaceCount: 1,
      singleWritableSpaceId: spaceId,
      selectionSource: "SINGLE_CANDIDATE",
      writeRequiresExplicitTarget: true,
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    });

    expect(context).toMatchObject({
      readSuggestedOrganizationId: organizationId,
      singleWritableSpaceId: spaceId,
      writeRequiresExplicitTarget: true,
    });
    expect("defaultOrganizationId" in context).toBe(false);
    expect("defaultSpaceId" in context).toBe(false);
  });

  it("separates tool business failures from JSON-RPC protocol errors", () => {
    expect(
      McpToolErrorResultSchema.parse({
        content: [
          {
            type: "text",
            text: "Idempotency key was reused with different arguments.",
          },
        ],
        structuredContent: {
          error: {
            code: "MCP_IDEMPOTENCY_CONFLICT",
            message: "Idempotency conflict.",
          },
        },
        isError: true,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "MCP_IDEMPOTENCY_CONFLICT",
        },
      },
    });
    expect(
      McpJsonRpcErrorResponseSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32601,
          message: "Method not found.",
        },
      }),
    ).toMatchObject({
      error: {
        code: -32601,
      },
    });
    expect(
      McpToolsCallRequestSchema.parse({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "pdm.requirement.create",
          arguments: {},
        },
      }),
    ).toMatchObject({
      method: "tools/call",
    });
  });

  it("documents the idempotency conflict key scope", () => {
    expect(
      McpIdempotencyScopeSchema.parse({
        userId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        clientId: "claude-desktop",
        toolName: "pdm.requirement.create",
        idempotencyKey: "req-create-2026-05-22",
        requestHash: "a".repeat(64),
      }),
    ).toMatchObject({
      clientId: "claude-desktop",
      toolName: "pdm.requirement.create",
    });
    expect(
      McpIdempotencyConflictDetailsSchema.parse({
        code: "MCP_IDEMPOTENCY_CONFLICT",
        toolName: "pdm.requirement.create",
        idempotencyKey: "req-create-2026-05-22",
        message: "Same idempotency key was used with different arguments.",
      }),
    ).toMatchObject({
      code: "MCP_IDEMPOTENCY_CONFLICT",
    });
  });

  it("keeps the MCP endpoint out of ApiResponse wrapping", () => {
    const mcpContract = apiContracts.find(
      (contract) => contract.operationId === "handleMcpStreamableHttp",
    );
    const document = generateOpenApiDocument();
    const response = document.paths["/mcp"]?.post?.responses["200"] as
      | {
          content?: Record<string, { schema?: Record<string, unknown> }>;
        }
      | undefined;
    const schema = response?.content?.["application/json"]?.schema;

    expect(mcpContract?.path).toBe("/mcp");
    expect(mcpContract?.responseWrapped).toBe(false);
    expect(schema).toBeDefined();
    expect(schema).toHaveProperty("anyOf");
    expect(JSON.stringify(schema)).toContain('"jsonrpc"');
    for (const variant of (schema?.["anyOf"] ?? []) as Array<{
      properties?: Record<string, unknown>;
    }>) {
      expect(variant.properties).not.toHaveProperty("data");
    }
  });
});
