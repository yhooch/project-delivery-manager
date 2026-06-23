import { z } from "zod";
import {
  ApiErrorCodeSchema,
  EmptyObjectSchema,
  IsoDateTimeSchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  AppendDocumentContentRequestSchema,
  CancelRequirementRequestSchema,
  CancelRequirementResponseSchema,
  ConvertDocumentToRequirementRequestSchema,
  ConvertDocumentToRequirementResponseSchema,
  CreateDocumentFolderRequestSchema,
  CreateDocumentFolderResponseSchema,
  DocumentListQuerySchema,
  DocumentListItemSchema,
  ListDocumentFoldersResponseSchema,
  GetDocumentResponseSchema,
  ArchiveDocumentResponseSchema,
  DeleteDocumentResponseSchema,
  DeleteDocumentFolderResponseSchema,
  DocumentFolderSchema,
  DocumentMaxMarkdownBytes,
  MoveDocumentFolderRequestSchema,
  MoveDocumentFolderResponseSchema,
  MoveDocumentToFolderRequestSchema,
  MoveDocumentToFolderResponseSchema,
  PasteDocumentRequestSchema,
  ReplaceDocumentLinksRequestSchema,
  ReplaceDocumentLinksResponseSchema,
  UpdateDocumentFolderRequestSchema,
  UpdateDocumentFolderResponseSchema,
  UpdateDocumentContentRequestSchema,
  UpdateDocumentMetadataRequestSchema,
  UpdateDocumentMetadataResponseSchema,
  UpdateDocumentContentResponseSchema,
  CreateDocumentResponseSchema,
  type AppendDocumentContentRequest,
  type CancelRequirementRequest,
  type ConvertDocumentToRequirementRequest,
  type DocumentListQuery,
  type DocumentFolder,
  type PasteDocumentRequest,
  type ReplaceDocumentLinksRequest,
  type UpdateDocumentMetadataRequest,
} from "./document.ts";
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
  DeleteCommentResponseSchema,
  TimelineQuerySchema,
  TimelineResponseSchema,
  UpdateCommentRequestSchema,
  UpdateCommentResponseSchema,
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
import {
  AppSessionCapabilitiesSchema,
  SessionOrganizationSummarySchema,
  SessionSpaceSummarySchema,
} from "./auth.ts";
import { SessionUserSchema } from "./user.ts";

export const McpEndpointPath = "/api/v1/mcp";
export const McpProtectedResourceMetadataPath =
  "/.well-known/oauth-protected-resource";
export const McpAuthorizationServerMetadataPath =
  "/.well-known/oauth-authorization-server";
export const McpAuthorizePath = "/oauth/authorize";
export const McpAuthorizeApprovalPath = "/oauth/authorize/approve";
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
  "mcp:write:document",
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
export type McpOAuthClientStatus = z.infer<typeof McpOAuthClientStatusSchema>;

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

export const McpOAuthApproveAuthorizationResponseSchema = z
  .object({
    redirectTo: z.url(),
  })
  .strict();

export type McpOAuthApproveAuthorizationResponse = z.infer<
  typeof McpOAuthApproveAuthorizationResponseSchema
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

export const McpOAuthRefreshTokenRequestSchema = McpOAuthTokenBaseSchema.extend(
  {
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    scope: McpScopeStringSchema.optional(),
  },
).strict();

export const McpOAuthTokenRequestSchema = z.discriminatedUnion("grant_type", [
  McpOAuthAuthorizationCodeTokenRequestSchema,
  McpOAuthRefreshTokenRequestSchema,
]);

export type McpOAuthTokenRequest = z.infer<typeof McpOAuthTokenRequestSchema>;

export const McpOAuthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
    scope: McpScopeStringSchema,
  })
  .strict();

export type McpOAuthTokenResponse = z.infer<typeof McpOAuthTokenResponseSchema>;

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
    targetSelectionSource: z
      .enum(["USER_EXPLICIT", "SINGLE_WRITABLE_SPACE", "MCP_CONTEXT_FALLBACK"])
      .optional()
      .describe(
        "Required for committed writes. Use USER_EXPLICIT only after the user names the organization and project space. Use SINGLE_WRITABLE_SPACE only when pdm.context.get shows exactly one writable project space. Never use MCP_CONTEXT_FALLBACK for committed writes.",
      ),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type McpWriteContext = z.infer<typeof McpWriteContextSchema>;
export const McpWriteTargetSelectionSourceSchema =
  McpWriteContextSchema.shape.targetSelectionSource.unwrap();
export type McpWriteTargetSelectionSource = z.infer<
  typeof McpWriteTargetSelectionSourceSchema
>;

export const McpContextSelectionSourceSchema = z.enum([
  "SINGLE_CANDIDATE",
  "FALLBACK",
]);
export type McpContextSelectionSource = z.infer<
  typeof McpContextSelectionSourceSchema
>;

export const McpContextSchema = z
  .object({
    user: SessionUserSchema,
    organizations: z.array(SessionOrganizationSummarySchema),
    spaces: z.array(SessionSpaceSummarySchema),
    readSuggestedOrganizationId: UlidSchema.optional(),
    readSuggestedSpaceId: UlidSchema.optional(),
    writableSpaceCount: z.number().int().min(0),
    singleWritableSpaceId: UlidSchema.optional(),
    selectionSource: McpContextSelectionSourceSchema,
    writeRequiresExplicitTarget: z.literal(true),
    capabilities: AppSessionCapabilitiesSchema,
  })
  .strict();

export type McpContext = z.infer<typeof McpContextSchema>;

export const McpIdempotencyScopeSchema = z
  .object({
    userId: UlidSchema,
    clientId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(128),
    idempotencyKey: z.string().min(8).max(120),
    requestHash: z.string().min(32).max(128),
  })
  .strict();

export type McpIdempotencyScope = z.infer<typeof McpIdempotencyScopeSchema>;

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

const DocumentIdToolInputSchema = z
  .object({
    documentId: UlidSchema,
  })
  .strict();

const CommentIdToolInputSchema = z
  .object({
    commentId: UlidSchema,
  })
  .strict();

const DocumentFolderIdToolInputSchema = z
  .object({
    folderId: UlidSchema,
  })
  .strict();

const DocumentStateToolInputSchema = z
  .object({
    baseRevision: z.coerce.number().int().positive(),
  })
  .strict();

export const McpUpdateCommentRequestSchema = McpWriteContextSchema.merge(
  CommentIdToolInputSchema,
).merge(UpdateCommentRequestSchema);

export type McpUpdateCommentRequest = z.infer<
  typeof McpUpdateCommentRequestSchema
>;

export const McpDeleteCommentRequestSchema = McpWriteContextSchema.merge(
  CommentIdToolInputSchema,
);

export type McpDeleteCommentRequest = z.infer<
  typeof McpDeleteCommentRequestSchema
>;

export const McpDeleteCommentResponseSchema = DeleteCommentResponseSchema;

export type McpDeleteCommentResponse = z.infer<
  typeof McpDeleteCommentResponseSchema
>;

export const McpListDocumentFoldersRequestSchema = SpaceToolContextSchema;

export type McpListDocumentFoldersRequest = z.infer<
  typeof McpListDocumentFoldersRequestSchema
>;

export const McpListDocumentFoldersResponseSchema =
  ListDocumentFoldersResponseSchema;

export type McpListDocumentFoldersResponse = z.infer<
  typeof McpListDocumentFoldersResponseSchema
>;

export const McpDocumentFolderSchema = DocumentFolderSchema;
export type McpDocumentFolder = DocumentFolder;

export const McpCreateDocumentFolderRequestSchema = McpWriteContextSchema.merge(
  CreateDocumentFolderRequestSchema,
);

export type McpCreateDocumentFolderRequest = z.infer<
  typeof McpCreateDocumentFolderRequestSchema
>;

export const McpUpdateDocumentFolderRequestSchema = McpWriteContextSchema.merge(
  DocumentFolderIdToolInputSchema,
).merge(UpdateDocumentFolderRequestSchema);

export type McpUpdateDocumentFolderRequest = z.infer<
  typeof McpUpdateDocumentFolderRequestSchema
>;

export const McpMoveDocumentFolderRequestSchema = McpWriteContextSchema.merge(
  DocumentFolderIdToolInputSchema,
).merge(MoveDocumentFolderRequestSchema);

export type McpMoveDocumentFolderRequest = z.infer<
  typeof McpMoveDocumentFolderRequestSchema
>;

export const McpDeleteDocumentFolderRequestSchema = McpWriteContextSchema.merge(
  DocumentFolderIdToolInputSchema,
);

export type McpDeleteDocumentFolderRequest = z.infer<
  typeof McpDeleteDocumentFolderRequestSchema
>;

export const McpDeleteDocumentFolderResponseSchema =
  DeleteDocumentFolderResponseSchema;

export type McpDeleteDocumentFolderResponse = z.infer<
  typeof McpDeleteDocumentFolderResponseSchema
>;

export const McpArchiveDocumentRequestSchema = McpWriteContextSchema.merge(
  DocumentIdToolInputSchema,
).merge(DocumentStateToolInputSchema);

export type McpArchiveDocumentRequest = z.infer<
  typeof McpArchiveDocumentRequestSchema
>;

export const McpArchiveDocumentResponseSchema = ArchiveDocumentResponseSchema;

export type McpArchiveDocumentResponse = z.infer<
  typeof McpArchiveDocumentResponseSchema
>;

export const McpDeleteDocumentRequestSchema = McpWriteContextSchema.merge(
  DocumentIdToolInputSchema,
).merge(DocumentStateToolInputSchema);

export type McpDeleteDocumentRequest = z.infer<
  typeof McpDeleteDocumentRequestSchema
>;

export const McpDeleteDocumentResponseSchema = DeleteDocumentResponseSchema;

export type McpDeleteDocumentResponse = z.infer<
  typeof McpDeleteDocumentResponseSchema
>;

export const McpDocumentSearchRequestSchema = SpaceToolContextSchema.merge(
  DocumentListQuerySchema,
).superRefine((value, context) => {
  if (value.includeDescendants === true && !value.folderId) {
    context.addIssue({
      code: "custom",
      message: "includeDescendants requires folderId",
      path: ["includeDescendants"],
    });
  }
});

export type McpDocumentSearchRequest = DocumentListQuery & {
  spaceId: string;
};

export const McpDocumentSearchHitSchema = z
  .object({
    chunkId: UlidSchema,
    ordinal: z.number().int().min(0),
    headingPath: z.string().min(1).max(1000).optional(),
    snippet: z.string().min(1).max(400),
  })
  .strict();

export type McpDocumentSearchHit = z.infer<typeof McpDocumentSearchHitSchema>;

export const McpDocumentSearchResultSchema = DocumentListItemSchema.extend({
  hits: z.array(McpDocumentSearchHitSchema).max(3),
}).strict();

export type McpDocumentSearchResult = z.infer<
  typeof McpDocumentSearchResultSchema
>;

export const McpDocumentSearchResponseSchema = pageResultSchema(
  McpDocumentSearchResultSchema,
);

export type McpDocumentSearchResponse = z.infer<
  typeof McpDocumentSearchResponseSchema
>;

const VersionBoardToolInputSchema = z
  .object({
    versionId: UlidSchema,
  })
  .merge(VersionBoardViewQuerySchema)
  .strict();

const SpaceOverviewToolInputSchema = SpaceToolContextSchema.merge(
  SpaceOverviewViewQuerySchema,
);

const SpaceExceptionsToolInputSchema = SpaceToolContextSchema.merge(
  SpaceExceptionsViewQuerySchema,
);

const IntakeListToolInputSchema = SpaceToolContextSchema.merge(
  IntakeItemListQuerySchema,
);

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

export const McpCreateDocumentFromMarkdownRequestSchema =
  McpWriteContextSchema.merge(
    PasteDocumentRequestSchema.omit({
      sourceType: true,
    }),
  );

export type McpCreateDocumentFromMarkdownRequest = McpWriteContext & {
  contentMarkdown: PasteDocumentRequest["contentMarkdown"];
  folderId?: string;
  links?: PasteDocumentRequest["links"];
  tagIds?: PasteDocumentRequest["tagIds"];
  title?: PasteDocumentRequest["title"];
};

export const McpAppendDocumentContentRequestSchema =
  McpWriteContextSchema.merge(DocumentIdToolInputSchema).merge(
    AppendDocumentContentRequestSchema,
  );

export type McpAppendDocumentContentRequest = McpWriteContext &
  AppendDocumentContentRequest & {
    documentId: string;
  };

const McpReplaceDocumentContentBodySchema = z
  .object({
    baseRevision: z.coerce.number().int().positive(),
    contentFormat: z.literal("MARKDOWN").optional(),
    contentMarkdown: z.string().min(1).max(DocumentMaxMarkdownBytes),
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = UpdateDocumentContentRequestSchema.safeParse({
      baseRevision: value.baseRevision,
      contentFormat: value.contentFormat,
      contentMarkdown: value.contentMarkdown,
    });

    if (parsed.success) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  });

export const McpReplaceDocumentContentRequestSchema =
  McpWriteContextSchema.merge(DocumentIdToolInputSchema).merge(
    McpReplaceDocumentContentBodySchema,
  );

export type McpReplaceDocumentContentRequest = z.infer<
  typeof McpReplaceDocumentContentRequestSchema
>;

export const McpUpdateDocumentMetadataRequestSchema =
  McpWriteContextSchema.merge(DocumentIdToolInputSchema).merge(
    UpdateDocumentMetadataRequestSchema,
  );

export type McpUpdateDocumentMetadataRequest = McpWriteContext &
  UpdateDocumentMetadataRequest & {
    documentId: string;
  };

export const McpLinkDocumentResourcesRequestSchema =
  McpWriteContextSchema.merge(DocumentIdToolInputSchema).merge(
    ReplaceDocumentLinksRequestSchema,
  );

export type McpLinkDocumentResourcesRequest = McpWriteContext &
  ReplaceDocumentLinksRequest & {
    documentId: string;
  };

export const McpMoveDocumentToFolderRequestSchema = McpWriteContextSchema.merge(
  DocumentIdToolInputSchema,
).merge(MoveDocumentToFolderRequestSchema);

export type McpMoveDocumentToFolderRequest = McpWriteContext & {
  baseRevision?: number;
  documentId: string;
  folderId?: string | null;
};

export const McpConvertDocumentToRequirementRequestSchema =
  McpWriteContextSchema.merge(DocumentIdToolInputSchema).merge(
    ConvertDocumentToRequirementRequestSchema,
  );

export type McpConvertDocumentToRequirementRequest = McpWriteContext &
  ConvertDocumentToRequirementRequest & {
    documentId: string;
  };

export const McpCancelRequirementRequestSchema = McpWriteContextSchema.merge(
  DocumentIdToolInputSchema,
).merge(CancelRequirementRequestSchema);

export type McpCancelRequirementRequest = McpWriteContext &
  CancelRequirementRequest & {
    documentId: string;
  };

const McpReplaceTagAssignmentsRequestSchema = McpWriteContextSchema.merge(
  ReplaceTagAssignmentsRequestSchema,
);

export const McpToolNameSchema = z.enum([
  "pdm.context.get",
  "pdm.object.lookup_code",
  "pdm.workbench.get",
  "pdm.space.overview_get",
  "pdm.version.board_get",
  "pdm.exceptions.list",
  "pdm.requirement.get",
  "pdm.requirement.create",
  "pdm.intake.list",
  "pdm.intake.create",
  "pdm.work_item.get",
  "pdm.work_item.create_task",
  "pdm.work_item.update",
  "pdm.work_item.execute_action",
  "pdm.bug.get",
  "pdm.bug.create",
  "pdm.comment.create",
  "pdm.comment.update",
  "pdm.comment.delete",
  "pdm.document_folder.list",
  "pdm.document_folder.create",
  "pdm.document_folder.update",
  "pdm.document_folder.move",
  "pdm.document_folder.delete",
  "pdm.document.search",
  "pdm.document.get",
  "pdm.document.create_from_markdown",
  "pdm.document.append_content",
  "pdm.document.replace_content",
  "pdm.document.update_metadata",
  "pdm.document.link_resources",
  "pdm.document.move_to_folder",
  "pdm.document.archive",
  "pdm.document.delete",
  "pdm.document.convert_to_requirement",
  "pdm.document.cancel_requirement",
  "pdm.tag.replace_assignments",
  "pdm.timeline.list",
]);

export type McpToolName = z.infer<typeof McpToolNameSchema>;

export const McpDryRunResultSchema = z
  .object({
    dryRun: z.literal(true),
    committed: z.literal(false),
    toolName: McpToolNameSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    targetSelectionSource: McpWriteTargetSelectionSourceSchema.optional(),
    canWrite: z.boolean(),
    requiresConfirmation: z.boolean(),
    targetOrganizationName: z.string().min(1).max(120).optional(),
    targetSpaceName: z.string().min(1).max(120).optional(),
    validated: z.array(z.string().min(1)).min(1),
    message: z.string().min(1).max(500),
    reason: z.string().min(1).max(500).optional(),
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

const WriteTargetPolicyDescription =
  " Do not use pdm.context.get fallback suggestions as write targets. Set targetSelectionSource=USER_EXPLICIT after the user names the organization and project space, or SINGLE_WRITABLE_SPACE only when there is exactly one writable project space.";

export const mcpToolContracts = [
  tool({
    name: "pdm.context.get",
    title: "Get PDM context",
    description:
      "Return current user, organization, space and capability context. Returned suggestions are for reading/navigation only and are not write targets.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: EmptyObjectSchema,
    outputSchema: McpContextSchema,
  }),
  tool({
    name: "pdm.object.lookup_code",
    title: "Lookup object by display code",
    description:
      "Resolve REQ-n, INTAKE-n, TASK-n or BUG-n within allowed scope.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: ObjectCodeLookupQuerySchema,
    outputSchema: ObjectCodeLookupResultSchema,
  }),
  tool({
    name: "pdm.workbench.get",
    title: "Get my workbench",
    description: "Return the current user's workbench view.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: WorkbenchViewQuerySchema,
    outputSchema: GetMyWorkbenchViewResponseSchema,
  }),
  tool({
    name: "pdm.space.overview_get",
    title: "Get space overview",
    description: "Return operational overview for a project space.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: SpaceOverviewToolInputSchema,
    outputSchema: GetSpaceOverviewViewResponseSchema,
  }),
  tool({
    name: "pdm.version.board_get",
    title: "Get version board",
    description: "Return the version board grouped by status category.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: VersionBoardToolInputSchema,
    outputSchema: GetVersionBoardViewResponseSchema,
  }),
  tool({
    name: "pdm.exceptions.list",
    title: "List space exceptions",
    description:
      "Return overdue, blocked, pending and stale work item signals.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: SpaceExceptionsToolInputSchema,
    outputSchema: GetSpaceExceptionsViewResponseSchema,
  }),
  tool({
    name: "pdm.requirement.get",
    title: "Get requirement",
    description: "Return requirement detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: RequirementIdToolInputSchema,
    outputSchema: RequirementSchema,
  }),
  tool({
    name: "pdm.requirement.create",
    title: "Create Markdown requirement",
    description: `Create a confirmed requirement from Markdown content.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:requirement"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateRequirementRequestSchema,
    outputSchema: writeOutputSchema(RequirementSchema),
  }),
  tool({
    name: "pdm.intake.list",
    title: "List intake items",
    description: "Return intake items in a project space.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: IntakeListToolInputSchema,
    outputSchema: ListIntakeItemsResponseSchema,
  }),
  tool({
    name: "pdm.intake.create",
    title: "Create intake item",
    description: `Create an intake item in a project space.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:intake"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateIntakeRequestSchema,
    outputSchema: writeOutputSchema(IntakeItemSchema),
  }),
  tool({
    name: "pdm.work_item.get",
    title: "Get work item",
    description: "Return task or work item detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: WorkItemIdToolInputSchema,
    outputSchema: GetWorkItemResponseSchema,
  }),
  tool({
    name: "pdm.work_item.create_task",
    title: "Create task",
    description: `Create a task work item in a project space.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:workitem"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateTaskRequestSchema,
    outputSchema: writeOutputSchema(CreateWorkItemResponseSchema),
  }),
  tool({
    name: "pdm.work_item.update",
    title: "Update work item",
    description: `Update editable task or work item fields.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:workitem"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpUpdateWorkItemRequestSchema,
    outputSchema: writeOutputSchema(GetWorkItemResponseSchema),
  }),
  tool({
    name: "pdm.work_item.execute_action",
    title: "Execute workflow action",
    description: `Execute an available workflow action on a work item.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:execute:workflow"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpExecuteWorkItemActionRequestSchema,
    outputSchema: writeOutputSchema(GetWorkItemResponseSchema),
  }),
  tool({
    name: "pdm.bug.get",
    title: "Get bug",
    description: "Return bug detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: BugIdToolInputSchema,
    outputSchema: GetBugResponseSchema,
  }),
  tool({
    name: "pdm.bug.create",
    title: "Create bug",
    description: `Create a bug in a project space.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:bug"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateBugRequestSchema,
    outputSchema: writeOutputSchema(CreateBugResponseSchema),
  }),
  tool({
    name: "pdm.comment.create",
    title: "Create comment",
    description: `Add a comment to a requirement, intake item, work item or document.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:comment"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateCommentRequestSchema,
    outputSchema: writeOutputSchema(CreateCommentResponseSchema),
  }),
  tool({
    name: "pdm.comment.update",
    title: "Update comment",
    description: `Update a comment owned by the current user.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:comment"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpUpdateCommentRequestSchema,
    outputSchema: writeOutputSchema(UpdateCommentResponseSchema),
  }),
  tool({
    name: "pdm.comment.delete",
    title: "Delete comment",
    description: `Delete a comment owned by the current user.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:comment"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpDeleteCommentRequestSchema,
    outputSchema: writeOutputSchema(McpDeleteCommentResponseSchema),
  }),
  tool({
    name: "pdm.document_folder.list",
    title: "List document folders",
    description:
      "Return the shared document folder tree for a project space as preorder nodes with counts.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: McpListDocumentFoldersRequestSchema,
    outputSchema: McpListDocumentFoldersResponseSchema,
  }),
  tool({
    name: "pdm.document_folder.create",
    title: "Create document folder",
    description: `Create a shared document folder in a project space.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateDocumentFolderRequestSchema,
    outputSchema: writeOutputSchema(CreateDocumentFolderResponseSchema),
  }),
  tool({
    name: "pdm.document_folder.update",
    title: "Update document folder",
    description: `Rename a shared document folder.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpUpdateDocumentFolderRequestSchema,
    outputSchema: writeOutputSchema(UpdateDocumentFolderResponseSchema),
  }),
  tool({
    name: "pdm.document_folder.move",
    title: "Move document folder",
    description: `Move a shared document folder under another folder or back to the root.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpMoveDocumentFolderRequestSchema,
    outputSchema: writeOutputSchema(MoveDocumentFolderResponseSchema),
  }),
  tool({
    name: "pdm.document_folder.delete",
    title: "Delete document folder",
    description: `Delete an empty shared document folder.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpDeleteDocumentFolderRequestSchema,
    outputSchema: writeOutputSchema(McpDeleteDocumentFolderResponseSchema),
  }),
  tool({
    name: "pdm.document.search",
    title: "Search documents",
    description: "Search documents in a project space.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: McpDocumentSearchRequestSchema,
    outputSchema: McpDocumentSearchResponseSchema,
  }),
  tool({
    name: "pdm.document.get",
    title: "Get document",
    description: "Return document detail visible to the current user.",
    scopes: ["mcp:read"],
    annotations: ReadToolAnnotations,
    inputSchema: DocumentIdToolInputSchema,
    outputSchema: GetDocumentResponseSchema,
  }),
  tool({
    name: "pdm.document.create_from_markdown",
    title: "Create document from Markdown",
    description: `Create a document from Markdown content.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: CreateToolAnnotations,
    inputSchema: McpCreateDocumentFromMarkdownRequestSchema,
    outputSchema: writeOutputSchema(CreateDocumentResponseSchema),
  }),
  tool({
    name: "pdm.document.append_content",
    title: "Append document content",
    description: `Append Markdown content to a document. Requires baseRevision. Requirement documents also require mcp:write:requirement.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpAppendDocumentContentRequestSchema,
    outputSchema: writeOutputSchema(UpdateDocumentContentResponseSchema),
  }),
  tool({
    name: "pdm.document.replace_content",
    title: "Replace document content",
    description: `Replace a document's full Markdown content. Requires baseRevision. Requirement documents also require mcp:write:requirement.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpReplaceDocumentContentRequestSchema,
    outputSchema: writeOutputSchema(UpdateDocumentContentResponseSchema),
  }),
  tool({
    name: "pdm.document.update_metadata",
    title: "Update document metadata",
    description: `Update document title, tags or linked resources. Requirement documents also require mcp:write:requirement.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpUpdateDocumentMetadataRequestSchema,
    outputSchema: writeOutputSchema(UpdateDocumentMetadataResponseSchema),
  }),
  tool({
    name: "pdm.document.link_resources",
    title: "Link document resources",
    description: `Replace the resources linked to a document. Requires baseRevision. Requirement documents also require mcp:write:requirement.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpLinkDocumentResourcesRequestSchema,
    outputSchema: writeOutputSchema(ReplaceDocumentLinksResponseSchema),
  }),
  tool({
    name: "pdm.document.move_to_folder",
    title: "Move document to folder",
    description: `Move a document into a shared folder, or pass folderId=null to move it to Unfiled. Requirement documents also require mcp:write:requirement.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpMoveDocumentToFolderRequestSchema,
    outputSchema: writeOutputSchema(MoveDocumentToFolderResponseSchema),
  }),
  tool({
    name: "pdm.document.archive",
    title: "Archive document",
    description: `Archive a general document. Requires baseRevision.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpArchiveDocumentRequestSchema,
    outputSchema: writeOutputSchema(McpArchiveDocumentResponseSchema),
  }),
  tool({
    name: "pdm.document.delete",
    title: "Delete document",
    description: `Delete a general document. Requires baseRevision.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpDeleteDocumentRequestSchema,
    outputSchema: writeOutputSchema(McpDeleteDocumentResponseSchema),
  }),
  tool({
    name: "pdm.document.convert_to_requirement",
    title: "Convert document to requirement",
    description: `Convert a general document into a requirement. Requires baseRevision and document plus requirement write scopes.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document", "mcp:write:requirement"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpConvertDocumentToRequirementRequestSchema,
    outputSchema: writeOutputSchema(ConvertDocumentToRequirementResponseSchema),
  }),
  tool({
    name: "pdm.document.cancel_requirement",
    title: "Cancel requirement semantics",
    description: `Remove requirement semantics from a requirement document while keeping the document. Requires baseRevision and document plus requirement write scopes.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:document", "mcp:write:requirement"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpCancelRequirementRequestSchema,
    outputSchema: writeOutputSchema(CancelRequirementResponseSchema),
  }),
  tool({
    name: "pdm.tag.replace_assignments",
    title: "Replace tag assignments",
    description: `Replace all tags assigned to a requirement, intake item or work item.${WriteTargetPolicyDescription}`,
    scopes: ["mcp:write:tag"],
    annotations: UpdateToolAnnotations,
    inputSchema: McpReplaceTagAssignmentsRequestSchema,
    outputSchema: writeOutputSchema(ReplaceTagAssignmentsResponseSchema),
  }),
  tool({
    name: "pdm.timeline.list",
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

export type McpToolBusinessError = z.infer<typeof McpToolBusinessErrorSchema>;

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
export type McpJsonRpcRequestId = z.infer<typeof McpJsonRpcRequestIdSchema>;

export const McpJsonRpcResponseIdSchema = McpJsonRpcRequestIdSchema.or(
  z.null(),
);
export type McpJsonRpcResponseId = z.infer<typeof McpJsonRpcResponseIdSchema>;

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

export type McpInitializeResult = z.infer<typeof McpInitializeResultSchema>;

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
