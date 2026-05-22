import { z } from "zod";
import {
  ApiErrorCodeSchema,
  EmptyObjectSchema,
  IsoDateTimeSchema,
  UlidSchema,
} from "./common.ts";
import {
  CreateIntakeItemRequestSchema,
  IntakeItemListQuerySchema,
  IntakeItemSchema,
  ListIntakeItemsResponseSchema,
} from "./intake.ts";
import {
  ObjectCodeLookupQuerySchema,
  ObjectCodeLookupResultSchema,
} from "./object-code.ts";
import { RequirementSchema } from "./requirement.ts";
import {
  CreateCommentRequestSchema,
  CreateCommentResponseSchema,
  TimelineQuerySchema,
  TimelineResponseSchema,
} from "./timeline.ts";
import {
  CreateBugRequestSchema,
  CreateBugResponseSchema,
  CreateWorkItemRequestSchema,
  CreateWorkItemResponseSchema,
  GetBugResponseSchema,
  GetWorkItemResponseSchema,
  UpdateWorkItemRequestSchema,
} from "./work-item.ts";
import {
  GetMyWorkbenchViewResponseSchema,
  GetSpaceExceptionsViewResponseSchema,
  GetSpaceOverviewViewResponseSchema,
  GetVersionBoardViewResponseSchema,
  SpaceExceptionsViewQuerySchema,
  SpaceOverviewViewQuerySchema,
  VersionBoardViewQuerySchema,
  WorkbenchViewQuerySchema,
} from "./view.ts";
import { ExecuteActionRequestSchema } from "./workflow.ts";
import {
  ReplaceTagAssignmentsRequestSchema,
  ReplaceTagAssignmentsResponseSchema,
  TagIdListSchema,
} from "./tag.ts";
import { PrioritySchema } from "./enums.ts";
import { AppSessionSchema } from "./auth.ts";

export const McpEndpointPath = "/api/v1/mcp";
export const McpProtectedResourceMetadataPath =
  "/.well-known/oauth-protected-resource";
export const McpAuthorizationServerMetadataPath =
  "/.well-known/oauth-authorization-server";
export const McpAuthorizePath = "/oauth/authorize";
export const McpTokenPath = "/oauth/token";
export const McpRevokePath = "/oauth/revoke";
export const McpRegisterPath = "/oauth/register";
export const McpProtocolVersionHeaderName = "MCP-Protocol-Version";
export const McpSessionIdHeaderName = "MCP-Session-Id";
export const McpSupportedProtocolVersions = [
  "2025-06-18",
  "2025-11-25",
] as const;

export const McpProtocolVersionSchema = z.enum(McpSupportedProtocolVersions);
export type McpProtocolVersion = z.infer<typeof McpProtocolVersionSchema>;

export const McpCanonicalResourceUriSchema = z
  .url()
  .refine((value) => new URL(value).hash === "", {
    message: "canonical MCP resource URI must not include a fragment",
  })
  .refine((value) => new URL(value).pathname === McpEndpointPath, {
    message: `canonical MCP resource URI path must be ${McpEndpointPath}`,
  });

export type McpCanonicalResourceUri = z.infer<
  typeof McpCanonicalResourceUriSchema
>;

export const McpScopeSchema = z.enum([
  "mcp:read",
  "mcp:write:requirement",
  "mcp:write:intake",
  "mcp:write:workitem",
  "mcp:write:bug",
  "mcp:write:comment",
  "mcp:write:tag",
  "mcp:execute:workflow",
]);
export type McpScope = z.infer<typeof McpScopeSchema>;

export const McpScopeListSchema = z.array(McpScopeSchema).min(1);
export type McpScopeList = z.infer<typeof McpScopeListSchema>;

export const McpScopeStringSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    for (const scope of value.split(/\s+/u)) {
      if (!McpScopeSchema.safeParse(scope).success) {
        context.addIssue({
          code: "custom",
          message: `Unsupported MCP scope: ${scope}`,
        });
      }
    }
  });

export const McpOAuthRedirectUriSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";

    return (
      url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)
    );
  },
  {
    message: "redirect_uri must use HTTPS or localhost",
  },
);

export const McpOAuthClientStatusSchema = z.enum([
  "ACTIVE",
  "DISABLED",
  "REVOKED",
]);
export type McpOAuthClientStatus = z.infer<
  typeof McpOAuthClientStatusSchema
>;

export const McpOAuthClientRegistrationModeSchema = z.enum([
  "PRE_REGISTERED",
  "CLIENT_ID_METADATA_DOCUMENT",
  "DYNAMIC_CLIENT_REGISTRATION",
]);
export type McpOAuthClientRegistrationMode = z.infer<
  typeof McpOAuthClientRegistrationModeSchema
>;

export const McpOAuthClientMetadataDocumentSchema = z
  .object({
    client_id: z.url(),
    client_name: z.string().min(1).max(120),
    client_uri: z.url().optional(),
    logo_uri: z.url().optional(),
    redirect_uris: z.array(McpOAuthRedirectUriSchema).min(1),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])),
    response_types: z.array(z.literal("code")),
    scope: McpScopeStringSchema.optional(),
  })
  .passthrough();

export type McpOAuthClientMetadataDocument = z.infer<
  typeof McpOAuthClientMetadataDocumentSchema
>;

export const McpOAuthDynamicClientRegistrationRequestSchema = z
  .object({
    redirect_uris: z.array(McpOAuthRedirectUriSchema).min(1),
    client_name: z.string().trim().min(1).max(120).optional(),
    client_uri: z.url().optional(),
    logo_uri: z.url().optional(),
    grant_types: z
      .array(z.enum(["authorization_code", "refresh_token"]))
      .min(1)
      .optional(),
    response_types: z.array(z.literal("code")).min(1).optional(),
    scope: McpScopeStringSchema.optional(),
    token_endpoint_auth_method: z.literal("none").optional(),
  })
  .passthrough();

export type McpOAuthDynamicClientRegistrationRequest = z.infer<
  typeof McpOAuthDynamicClientRegistrationRequestSchema
>;

export const McpOAuthDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1).max(200),
    client_id_issued_at: z.number().int().positive().optional(),
    client_name: z.string().min(1).max(120),
    client_uri: z.url().optional(),
    logo_uri: z.url().optional(),
    redirect_uris: z.array(McpOAuthRedirectUriSchema).min(1),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])),
    response_types: z.array(z.literal("code")),
    scope: McpScopeStringSchema,
    token_endpoint_auth_method: z.literal("none"),
  })
  .strict();

export type McpOAuthDynamicClientRegistrationResponse = z.infer<
  typeof McpOAuthDynamicClientRegistrationResponseSchema
>;

export const McpOAuthClientSchema = z
  .object({
    clientId: z.string().min(1).max(200),
    clientName: z.string().min(1).max(120),
    clientUri: z.url().optional(),
    redirectUris: z.array(McpOAuthRedirectUriSchema).min(1),
    scopes: z.array(McpScopeSchema).min(1),
    status: McpOAuthClientStatusSchema,
    registrationMode: McpOAuthClientRegistrationModeSchema,
    metadataDocumentUri: z.url().optional(),
    createdAt: IsoDateTimeSchema.optional(),
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type McpOAuthClient = z.infer<typeof McpOAuthClientSchema>;

export const McpAuthorizedClientStatusSchema = z.enum([
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
]);
export type McpAuthorizedClientStatus = z.infer<
  typeof McpAuthorizedClientStatusSchema
>;

export const AuthorizedMcpClientSchema = z
  .object({
    clientId: z.string().min(1).max(200),
    clientName: z.string().min(1).max(120),
    clientUri: z.url().optional(),
    scopes: z.array(McpScopeSchema).min(1),
    authorizedAt: IsoDateTimeSchema,
    lastUsedAt: IsoDateTimeSchema.optional(),
    expiresAt: IsoDateTimeSchema.optional(),
    status: McpAuthorizedClientStatusSchema,
  })
  .strict();

export type AuthorizedMcpClient = z.infer<typeof AuthorizedMcpClientSchema>;

export const ListAuthorizedMcpClientsResponseSchema = z.array(
  AuthorizedMcpClientSchema,
);
export type ListAuthorizedMcpClientsResponse = z.infer<
  typeof ListAuthorizedMcpClientsResponseSchema
>;

export const RevokeAuthorizedMcpClientRequestSchema = z
  .object({
    clientId: z.string().min(1).max(200),
  })
  .strict();
export type RevokeAuthorizedMcpClientRequest = z.infer<
  typeof RevokeAuthorizedMcpClientRequestSchema
>;
export const RevokeAuthorizedMcpClientResponseSchema = EmptyObjectSchema;
export type RevokeAuthorizedMcpClientResponse = z.infer<
  typeof RevokeAuthorizedMcpClientResponseSchema
>;

export const McpProtectedResourceMetadataSchema = z
  .object({
    resource: McpCanonicalResourceUriSchema,
    authorization_servers: z.array(z.url()).min(1),
    scopes_supported: z.array(McpScopeSchema).min(1),
    resource_name: z.string().min(1).max(120).optional(),
    bearer_methods_supported: z.array(z.literal("header")).default(["header"]),
  })
  .strict();

export type McpProtectedResourceMetadata = z.infer<
  typeof McpProtectedResourceMetadataSchema
>;

export const McpAuthorizationServerMetadataSchema = z
  .object({
    issuer: z.url(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    revocation_endpoint: z.url().optional(),
    response_types_supported: z.array(z.literal("code")),
    grant_types_supported: z.array(
      z.enum(["authorization_code", "refresh_token"]),
    ),
    code_challenge_methods_supported: z.array(z.literal("S256")),
    scopes_supported: z.array(McpScopeSchema).min(1),
    token_endpoint_auth_methods_supported: z.array(z.string().min(1)),
    client_id_metadata_document_supported: z.boolean().optional(),
    registration_endpoint: z.url().optional(),
  })
  .strict();

export type McpAuthorizationServerMetadata = z.infer<
  typeof McpAuthorizationServerMetadataSchema
>;

export const McpOAuthAuthorizeQuerySchema = z
  .object({
    response_type: z.literal("code"),
    client_id: z.string().min(1).max(200),
    redirect_uri: McpOAuthRedirectUriSchema,
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal("S256"),
    scope: McpScopeStringSchema,
    state: z.string().min(1).max(500).optional(),
    resource: McpCanonicalResourceUriSchema,
  })
  .passthrough();

export type McpOAuthAuthorizeQuery = z.infer<
  typeof McpOAuthAuthorizeQuerySchema
>;

export const McpOAuthAuthorizeContextSchema = z
  .object({
    client: McpOAuthClientSchema,
    redirectUri: McpOAuthRedirectUriSchema,
    redirectHostname: z.string().min(1).max(253),
    redirectIsLocalhost: z.boolean(),
    resource: McpCanonicalResourceUriSchema,
    scopes: z.array(McpScopeSchema).min(1),
    state: z.string().min(1).max(500).optional(),
  })
  .strict();

export type McpOAuthAuthorizeContext = z.infer<
  typeof McpOAuthAuthorizeContextSchema
>;

const McpOAuthTokenBaseSchema = z.object({
  client_id: z.string().min(1).max(200),
  resource: McpCanonicalResourceUriSchema,
});

export const McpOAuthAuthorizationCodeTokenRequestSchema =
  McpOAuthTokenBaseSchema.extend({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    redirect_uri: McpOAuthRedirectUriSchema,
    code_verifier: z.string().min(43).max(128),
  }).strict();

export const McpOAuthRefreshTokenRequestSchema =
  McpOAuthTokenBaseSchema.extend({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    scope: McpScopeStringSchema.optional(),
  }).strict();

export const McpOAuthTokenRequestSchema = z.discriminatedUnion("grant_type", [
  McpOAuthAuthorizationCodeTokenRequestSchema,
  McpOAuthRefreshTokenRequestSchema,
]);

export type McpOAuthTokenRequest = z.infer<
  typeof McpOAuthTokenRequestSchema
>;

export const McpOAuthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
    scope: McpScopeStringSchema,
  })
  .strict();

export type McpOAuthTokenResponse = z.infer<
  typeof McpOAuthTokenResponseSchema
>;

export const McpOAuthRevocationRequestSchema = z
  .object({
    token: z.string().min(1),
    token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
    client_id: z.string().min(1).max(200).optional(),
  })
  .strict();

export type McpOAuthRevocationRequest = z.infer<
  typeof McpOAuthRevocationRequestSchema
>;

export const McpBearerChallengeErrorSchema = z.enum([
  "invalid_token",
  "insufficient_scope",
]);
export type McpBearerChallengeError = z.infer<
  typeof McpBearerChallengeErrorSchema
>;

export const McpBearerChallengeSchema = z
  .object({
    scheme: z.literal("Bearer"),
    resource_metadata: z.url(),
    resource: McpCanonicalResourceUriSchema.optional(),
    scope: McpScopeStringSchema.optional(),
    error: McpBearerChallengeErrorSchema.optional(),
    error_description: z.string().min(1).max(500).optional(),
  })
  .strict();

export type McpBearerChallenge = z.infer<typeof McpBearerChallengeSchema>;

export const McpEndpointPolicySchema = z
  .object({
    path: z.literal(McpEndpointPath),
    transport: z.literal("STREAMABLE_HTTP"),
    post: z
      .object({
        acceptsJsonRpc: z.literal(true),
        acceptHeaderMustInclude: z.tuple([
          z.literal("application/json"),
          z.literal("text/event-stream"),
        ]),
        responseWrapped: z.literal(false),
      })
      .strict(),
    get: z
      .object({
        recognizedStreamEntry: z.literal(true),
        serverToClientSseEnabledInFirstPhase: z.literal(false),
        disabledStatus: z.literal(405),
      })
      .strict(),
    auth: z
      .object({
        authorizationHeaderScheme: z.literal("Bearer"),
        queryTokenAccepted: z.literal(false),
        webCookieAccepted: z.literal(false),
      })
      .strict(),
    protocol: z
      .object({
        supportedVersions: z.array(McpProtocolVersionSchema).min(1),
        protocolVersionHeaderName: z.literal(McpProtocolVersionHeaderName),
        requireProtocolVersionAfterInitialize: z.literal(true),
        unsupportedProtocolVersionStatus: z.literal(400),
      })
      .strict(),
    session: z
      .object({
        firstPhaseMode: z.literal("STATELESS_NO_MCP_SESSION_ID"),
        sessionIdHeaderName: z.literal(McpSessionIdHeaderName),
        issueSessionIdHeader: z.literal(false),
        requireSessionIdHeader: z.literal(false),
        deleteTerminatesSessionInFirstPhase: z.literal(false),
      })
      .strict(),
    capabilities: z
      .object({
        tools: z.literal(true),
        resources: z.literal(false),
        prompts: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type McpEndpointPolicy = z.infer<typeof McpEndpointPolicySchema>;

export const McpEndpointPolicy = {
  path: McpEndpointPath,
  transport: "STREAMABLE_HTTP",
  post: {
    acceptsJsonRpc: true,
    acceptHeaderMustInclude: ["application/json", "text/event-stream"],
    responseWrapped: false,
  },
  get: {
    recognizedStreamEntry: true,
    serverToClientSseEnabledInFirstPhase: false,
    disabledStatus: 405,
  },
  auth: {
    authorizationHeaderScheme: "Bearer",
    queryTokenAccepted: false,
    webCookieAccepted: false,
  },
  protocol: {
    supportedVersions: [...McpSupportedProtocolVersions],
    protocolVersionHeaderName: McpProtocolVersionHeaderName,
    requireProtocolVersionAfterInitialize: true,
    unsupportedProtocolVersionStatus: 400,
  },
  session: {
    firstPhaseMode: "STATELESS_NO_MCP_SESSION_ID",
    sessionIdHeaderName: McpSessionIdHeaderName,
    issueSessionIdHeader: false,
    requireSessionIdHeader: false,
    deleteTerminatesSessionInFirstPhase: false,
  },
  capabilities: {
    tools: true,
    resources: false,
    prompts: false,
  },
} satisfies McpEndpointPolicy;

export const McpWriteContextSchema = z
  .object({
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    idempotencyKey: z.string().min(8).max(120),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type McpWriteContext = z.infer<typeof McpWriteContextSchema>;

export const McpIdempotencyScopeSchema = z
  .object({
    userId: UlidSchema,
    clientId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(128),
    idempotencyKey: z.string().min(8).max(120),
    requestHash: z.string().min(32).max(128),
  })
  .strict();

export type McpIdempotencyScope = z.infer<
  typeof McpIdempotencyScopeSchema
>;

export const McpIdempotencyConflictDetailsSchema = z
  .object({
    code: z.literal("MCP_IDEMPOTENCY_CONFLICT"),
    toolName: z.string().min(1).max(128),
    idempotencyKey: z.string().min(8).max(120),
    message: z.string().min(1).max(500),
  })
  .strict();

export type McpIdempotencyConflictDetails = z.infer<
  typeof McpIdempotencyConflictDetailsSchema
>;

export const McpCreateRequirementRequestSchema = McpWriteContextSchema.merge(
  z
    .object({
      title: z.string().min(1).max(200),
      summary: z.string().max(2000).optional(),
      contentFormat: z.literal("MARKDOWN"),
      contentMarkdown: z.string().min(1).max(20000),
      versionId: UlidSchema.optional(),
      ownerId: UlidSchema.optional(),
      priority: PrioritySchema.optional(),
      tagIds: TagIdListSchema.optional(),
    })
    .strict(),
);

export type McpCreateRequirementRequest = z.infer<
  typeof McpCreateRequirementRequestSchema
>;

const SpaceToolContextSchema = z
  .object({
    spaceId: UlidSchema,
  })
  .strict();

const RequirementIdToolInputSchema = z
  .object({
    requirementId: UlidSchema,
  })
  .strict();

const WorkItemIdToolInputSchema = z
  .object({
    workItemId: UlidSchema,
  })
  .strict();

const BugIdToolInputSchema = z
  .object({
    bugId: UlidSchema,
  })
  .strict();

const VersionBoardToolInputSchema = z
  .object({
    versionId: UlidSchema,
  })
  .merge(VersionBoardViewQuerySchema)
  .strict();

const SpaceOverviewToolInputSchema =
  SpaceToolContextSchema.merge(SpaceOverviewViewQuerySchema);

const SpaceExceptionsToolInputSchema =
  SpaceToolContextSchema.merge(SpaceExceptionsViewQuerySchema);

const IntakeListToolInputSchema =
  SpaceToolContextSchema.merge(IntakeItemListQuerySchema);

const McpCreateIntakeRequestSchema = McpWriteContextSchema.merge(
  CreateIntakeItemRequestSchema,
);

const McpCreateTaskRequestSchema = McpWriteContextSchema.merge(
  CreateWorkItemRequestSchema,
);

const McpUpdateWorkItemRequestSchema = McpWriteContextSchema.merge(
  WorkItemIdToolInputSchema,
).merge(UpdateWorkItemRequestSchema);

const McpExecuteWorkItemActionRequestSchema = McpWriteContextSchema.merge(
  WorkItemIdToolInputSchema,
)
  .merge(
    z
      .object({
        actionId: UlidSchema,
      })
      .strict(),
  )
  .merge(ExecuteActionRequestSchema);

const McpCreateBugRequestSchema = McpWriteContextSchema.merge(
  CreateBugRequestSchema,
);

const McpCreateCommentRequestSchema = McpWriteContextSchema.merge(
  CreateCommentRequestSchema,
);

const McpReplaceTagAssignmentsRequestSchema = McpWriteContextSchema.merge(
  ReplaceTagAssignmentsRequestSchema,
);

export const McpToolNameSchema = z.enum([
  "crm.context.get",
  "crm.object.lookup_code",
  "crm.workbench.get",
  "crm.space.overview_get",
  "crm.version.board_get",
  "crm.exceptions.list",
  "crm.requirement.get",
  "crm.requirement.create",
  "crm.intake.list",
  "crm.intake.create",
  "crm.work_item.get",
  "crm.work_item.create_task",
  "crm.work_item.update",
  "crm.work_item.execute_action",
  "crm.bug.get",
  "crm.bug.create",
  "crm.comment.create",
  "crm.tag.replace_assignments",
  "crm.timeline.list",
]);

export type McpToolName = z.infer<typeof McpToolNameSchema>;

export const McpDryRunResultSchema = z
  .object({
    dryRun: z.literal(true),
    committed: z.literal(false),
    toolName: McpToolNameSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    validated: z.array(z.string().min(1)).min(1),
    message: z.string().min(1).max(500),
  })
  .strict();

export type McpDryRunResult = z.infer<typeof McpDryRunResultSchema>;

export const McpToolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean(),
  })
  .strict();

export type McpToolAnnotations = z.infer<typeof McpToolAnnotationsSchema>;

const ReadToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies McpToolAnnotations;

const CreateToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies McpToolAnnotations;

const UpdateToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} satisfies McpToolAnnotations;

type McpToolContract = {
  name: McpToolName;
  title: string;
  description: string;
  scopes: readonly McpScope[];
  annotations: McpToolAnnotations;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
};

function tool(contract: McpToolContract): McpToolContract {
  return contract;
}

function writeOutputSchema(schema: z.ZodType): z.ZodType {
  return z.union([schema, McpDryRunResultSchema]);
}

export const mcpToolContracts = [
  tool({
    name: "crm.context.get",
    title: "Get CRM context",
    description: "Return current user, organization, space and capability context.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: EmptyObjectSchema,
    outputSchema: AppSessionSchema,
  }),
  tool({
    name: "crm.object.lookup_code",
    title: "Lookup object by display code",
    description: "Resolve REQ-n, INTAKE-n, TASK-n or BUG-n within allowed scope.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: ObjectCodeLookupQuerySchema,
    outputSchema: ObjectCodeLookupResultSchema,
  }),
  tool({
    name: "crm.workbench.get",
    title: "Get my workbench",
    description: "Return the current user's workbench view.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: WorkbenchViewQuerySchema,
    outputSchema: GetMyWorkbenchViewResponseSchema,
  }),
  tool({
    name: "crm.space.overview_get",
    title: "Get space overview",
    description: "Return operational overview for a project space.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: SpaceOverviewToolInputSchema,
    outputSchema: GetSpaceOverviewViewResponseSchema,
  }),
  tool({
    name: "crm.version.board_get",
    title: "Get version board",
    description: "Return the version board grouped by status category.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: VersionBoardToolInputSchema,
    outputSchema: GetVersionBoardViewResponseSchema,
  }),
  tool({
    name: "crm.exceptions.list",
    title: "List space exceptions",
    description: "Return overdue, blocked, pending and stale work item signals.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: SpaceExceptionsToolInputSchema,
    outputSchema: GetSpaceExceptionsViewResponseSchema,
  }),
  tool({
    name: "crm.requirement.get",
    title: "Get requirement",
    description: "Return requirement detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: RequirementIdToolInputSchema,
    outputSchema: RequirementSchema,
  }),
  tool({
    name: "crm.requirement.create",
    title: "Create Markdown requirement",
    description: "Create a confirmed requirement from Markdown content.",
    scopes: ["mcp:write:requirement"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateRequirementRequestSchema,
    outputSchema: writeOutputSchema(RequirementSchema),
  }),
  tool({
    name: "crm.intake.list",
    title: "List intake items",
    description: "Return intake items in a project space.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: IntakeListToolInputSchema,
    outputSchema: ListIntakeItemsResponseSchema,
  }),
  tool({
    name: "crm.intake.create",
    title: "Create intake item",
    description: "Create an intake item in a project space.",
    scopes: ["mcp:write:intake"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateIntakeRequestSchema,
    outputSchema: writeOutputSchema(IntakeItemSchema),
  }),
  tool({
    name: "crm.work_item.get",
    title: "Get work item",
    description: "Return task or work item detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: WorkItemIdToolInputSchema,
    outputSchema: GetWorkItemResponseSchema,
  }),
  tool({
    name: "crm.work_item.create_task",
    title: "Create task",
    description: "Create a task work item in a project space.",
    scopes: ["mcp:write:workitem"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateTaskRequestSchema,
    outputSchema: writeOutputSchema(CreateWorkItemResponseSchema),
  }),
  tool({
    name: "crm.work_item.update",
    title: "Update work item",
    description: "Update editable task or work item fields.",
    scopes: ["mcp:write:workitem"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpUpdateWorkItemRequestSchema,
    outputSchema: writeOutputSchema(GetWorkItemResponseSchema),
  }),
  tool({
    name: "crm.work_item.execute_action",
    title: "Execute workflow action",
    description: "Execute an available workflow action on a work item.",
    scopes: ["mcp:execute:workflow"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpExecuteWorkItemActionRequestSchema,
    outputSchema: writeOutputSchema(GetWorkItemResponseSchema),
  }),
  tool({
    name: "crm.bug.get",
    title: "Get bug",
    description: "Return bug detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: BugIdToolInputSchema,
    outputSchema: GetBugResponseSchema,
  }),
  tool({
    name: "crm.bug.create",
    title: "Create bug",
    description: "Create a bug in a project space.",
    scopes: ["mcp:write:bug"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateBugRequestSchema,
    outputSchema: writeOutputSchema(CreateBugResponseSchema),
  }),
  tool({
    name: "crm.comment.create",
    title: "Create comment",
    description: "Add a comment to a requirement, intake item or work item.",
    scopes: ["mcp:write:comment"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateCommentRequestSchema,
    outputSchema: writeOutputSchema(CreateCommentResponseSchema),
  }),
  tool({
    name: "crm.tag.replace_assignments",
    title: "Replace tag assignments",
    description: "Replace all tags assigned to a requirement, intake item or work item.",
    scopes: ["mcp:write:tag"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpReplaceTagAssignmentsRequestSchema,
    outputSchema: writeOutputSchema(ReplaceTagAssignmentsResponseSchema),
  }),
  tool({
    name: "crm.timeline.list",
    title: "List timeline events",
    description: "Return timeline events for a supported target object.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: TimelineQuerySchema,
    outputSchema: TimelineResponseSchema,
  }),
] as const;

export const McpToolRegistrySchema = z.array(
  z
    .object({
      name: McpToolNameSchema,
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(500),
      scopes: z.array(McpScopeSchema).min(1),
      annotations: McpToolAnnotationsSchema,
      inputSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.record(z.string(), z.unknown()),
    })
    .strict(),
);

export type McpToolRegistry = z.infer<typeof McpToolRegistrySchema>;

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

export const mcpToolRegistry = mcpToolContracts.map((contract) => ({
  name: contract.name,
  title: contract.title,
  description: contract.description,
  scopes: [...contract.scopes],
  annotations: contract.annotations,
  inputSchema: toJsonSchema(contract.inputSchema),
  outputSchema: toJsonSchema(contract.outputSchema),
})) satisfies McpToolRegistry;

export const McpTextContentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1).max(4000),
  })
  .strict();

export type McpTextContent = z.infer<typeof McpTextContentSchema>;

export const McpToolBusinessErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(500),
    details: z.unknown().optional(),
  })
  .strict();

export type McpToolBusinessError = z.infer<
  typeof McpToolBusinessErrorSchema
>;

export const McpToolResultSchema = z
  .object({
    content: z.array(McpTextContentSchema).min(1),
    structuredContent: z.record(z.string(), z.unknown()).optional(),
    isError: z.boolean().optional(),
  })
  .strict();

export type McpToolResult = z.infer<typeof McpToolResultSchema>;

export const McpToolErrorResultSchema = McpToolResultSchema.extend({
  isError: z.literal(true),
  structuredContent: z
    .object({
      error: McpToolBusinessErrorSchema,
    })
    .strict(),
}).strict();

export type McpToolErrorResult = z.infer<typeof McpToolErrorResultSchema>;

export const McpJsonRpcRequestIdSchema = z.union([
  z.string().min(1),
  z.number().int(),
]);
export type McpJsonRpcRequestId = z.infer<
  typeof McpJsonRpcRequestIdSchema
>;

export const McpJsonRpcResponseIdSchema = McpJsonRpcRequestIdSchema.or(
  z.null(),
);
export type McpJsonRpcResponseId = z.infer<
  typeof McpJsonRpcResponseIdSchema
>;

export const McpServerCapabilitiesSchema = z
  .object({
    tools: z
      .object({
        listChanged: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export const McpInitializeParamsSchema = z
  .object({
    protocolVersion: McpProtocolVersionSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    clientInfo: z
      .object({
        name: z.string().min(1).max(120),
        title: z.string().min(1).max(120).optional(),
        version: z.string().min(1).max(80),
      })
      .passthrough(),
  })
  .passthrough();

export const McpInitializeResultSchema = z
  .object({
    protocolVersion: McpProtocolVersionSchema,
    capabilities: McpServerCapabilitiesSchema,
    serverInfo: z
      .object({
        name: z.string().min(1).max(120),
        version: z.string().min(1).max(80),
      })
      .strict(),
    instructions: z.string().max(2000).optional(),
  })
  .strict();

export type McpInitializeResult = z.infer<
  typeof McpInitializeResultSchema
>;

export const McpToolsListParamsSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .default({});

export const McpToolsListResultSchema = z
  .object({
    tools: McpToolRegistrySchema,
    nextCursor: z.string().min(1).optional(),
  })
  .strict();

export type McpToolsListResult = z.infer<typeof McpToolsListResultSchema>;

export const McpToolsCallParamsSchema = z
  .object({
    name: McpToolNameSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type McpToolsCallParams = z.infer<typeof McpToolsCallParamsSchema>;

export const McpInitializeRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcRequestIdSchema,
    method: z.literal("initialize"),
    params: McpInitializeParamsSchema,
  })
  .passthrough();

export const McpInitializedNotificationSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.literal("notifications/initialized"),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const McpToolsListRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcRequestIdSchema,
    method: z.literal("tools/list"),
    params: McpToolsListParamsSchema.optional(),
  })
  .passthrough();

export const McpToolsCallRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcRequestIdSchema,
    method: z.literal("tools/call"),
    params: McpToolsCallParamsSchema,
  })
  .passthrough();

export const McpJsonRpcRequestSchema = z.union([
  McpInitializeRequestSchema,
  McpToolsListRequestSchema,
  McpToolsCallRequestSchema,
]);

export const McpJsonRpcErrorCodeSchema = z.union([
  z.literal(-32700),
  z.literal(-32600),
  z.literal(-32601),
  z.literal(-32602),
  z.literal(-32603),
  z.literal(-32001),
]);
export type McpJsonRpcErrorCode = z.infer<typeof McpJsonRpcErrorCodeSchema>;

export const McpJsonRpcErrorSchema = z
  .object({
    code: McpJsonRpcErrorCodeSchema,
    message: z.string().min(1).max(500),
    data: z.unknown().optional(),
  })
  .strict();

export const McpJsonRpcSuccessResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcResponseIdSchema,
    result: z.unknown(),
  })
  .strict();

export const McpJsonRpcErrorResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: McpJsonRpcResponseIdSchema,
    error: McpJsonRpcErrorSchema,
  })
  .strict();

export const McpJsonRpcResponseSchema = z.union([
  McpJsonRpcSuccessResponseSchema,
  McpJsonRpcErrorResponseSchema,
]);

export type McpJsonRpcResponse = z.infer<typeof McpJsonRpcResponseSchema>;

export const McpJsonRpcClientMessageSchema = z.union([
  McpJsonRpcRequestSchema,
  McpInitializedNotificationSchema,
  McpJsonRpcResponseSchema,
]);

export type McpJsonRpcClientMessage = z.infer<
  typeof McpJsonRpcClientMessageSchema
>;
