import type { TagDto } from "@project-delivery/shared";
import { z } from "zod";

import { apiClient, type ApiRequestInit } from "./api-client";
import { normalizeTagApiQuery } from "./tag-query";

export type DocumentSourceType =
  | "UPLOAD_DOCX"
  | "UPLOAD_MARKDOWN"
  | "PASTE_MARKDOWN"
  | "PASTE_TEXT"
  | "MCP_CREATED";

export type DocumentActorType = "USER" | "MCP_CLIENT";
export type DocumentStatus = "ACTIVE" | "ARCHIVED";
export type DocumentFilterKey =
  | "all"
  | "createdByMe"
  | "mcpCreated"
  | "recentMcpEdited"
  | "archived";
export type DocumentLinkTargetType =
  | "DOCUMENT"
  | "VERSION"
  | "REQUIREMENT"
  | "INTAKE_ITEM"
  | "WORK_ITEM";

export type DocumentLinkSummary = {
  displayCode?: string | null;
  id: string;
  targetId: string;
  targetType: DocumentLinkTargetType;
  title: string;
  workItemType?: "TASK" | "BUG" | null;
};

export type DocumentSummary = {
  archivedAt?: string | null;
  contentSnippet?: string | null;
  createdAt: string;
  createdById?: string | null;
  createdByName?: string | null;
  createdMcpClientName?: string | null;
  createdVia?: DocumentActorType;
  id: string;
  lastEditedAt: string;
  lastEditedByName?: string | null;
  lastEditedMcpClientName?: string | null;
  lastEditedVia: DocumentActorType;
  links?: DocumentLinkSummary[];
  organizationId: string;
  revision: number;
  sourceType: DocumentSourceType;
  spaceId: string;
  status: DocumentStatus;
  tags?: TagDto[];
  title: string;
  updatedAt: string;
};

export type DocumentDetail = DocumentSummary & {
  attachments?: DocumentAttachmentSummary[];
  comments?: DocumentCommentSummary[];
  contentMarkdown: string;
  timeline?: DocumentTimelineSummary[];
};

export type DocumentAttachmentSummary = {
  fileName: string;
  id: string;
  size?: number | null;
};

export type DocumentCommentSummary = {
  authorName?: string | null;
  body: string;
  createdAt: string;
  id: string;
};

export type DocumentTimelineSummary = {
  actorName?: string | null;
  changeType: string;
  createdAt: string;
  id: string;
};

export type DocumentPageResult<TItem> = {
  items: TItem[];
  page?: number;
  pageSize?: number;
  total: number;
};

export type ListDocumentsInput = {
  currentUserId?: string;
  filter?: DocumentFilterKey;
  organizationId?: string;
  page?: number;
  pageSize?: number;
  query?: string;
  spaceId: string;
  tagIds?: string[];
  tagMatch?: "ANY" | "ALL";
};

export type PasteDocumentInput = {
  contentMarkdown: string;
  sourceType?: "PASTE_MARKDOWN" | "PASTE_TEXT";
  tagIds?: string[];
  title: string;
};

export type ImportDocumentInput = {
  file: File;
  title?: string;
};

export type UpdateDocumentInput = {
  baseRevision: number;
  contentMarkdown?: string;
  linkTargets?: Array<{
    targetId: string;
    targetType: DocumentLinkTargetType;
  }>;
  tagIds?: string[];
  title?: string;
};

export type ReimportDocumentInput = {
  baseRevision: number;
  file: File;
};

export type DocumentApiTransport = {
  delete<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  get<TData>(path: string, init?: ApiRequestInit): Promise<{ data: TData }>;
  patch<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
  post<TData>(
    path: string,
    body?: ApiRequestInit["body"],
    init?: ApiRequestInit,
  ): Promise<{ data: TData }>;
};

const defaultApi: DocumentApiTransport = apiClient;

const documentActorSchema = z.enum(["USER", "MCP_CLIENT"]);
const documentSourceSchema = z.enum([
  "UPLOAD_DOCX",
  "UPLOAD_MARKDOWN",
  "PASTE_MARKDOWN",
  "PASTE_TEXT",
  "MCP_CREATED",
]);
const documentStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
const linkTargetSchema = z.enum([
  "DOCUMENT",
  "VERSION",
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
]);

const tagSchema = z
  .object({
    colorKey: z.string().optional(),
    displayName: z.string().optional(),
    id: z.string(),
    name: z.string().optional(),
    normalizedName: z.string().optional(),
  })
  .passthrough()
  .transform((tag) => tag as TagDto);

const linkSchema = z
  .object({
    displayCode: z.string().nullish(),
    id: z.string(),
    targetId: z.string(),
    targetType: linkTargetSchema,
    title: z.string().catch(""),
    workItemType: z.enum(["TASK", "BUG"]).nullish(),
  })
  .passthrough();

const documentSummaryBaseSchema = z
  .object({
    archivedAt: z.string().nullish(),
    contentSnippet: z.string().nullish(),
    contentText: z.string().optional(),
    createdAt: z.string(),
    createdById: z.string().nullish(),
    createdByName: z.string().nullish(),
    createdMcpClientName: z.string().nullish(),
    createdVia: documentActorSchema.optional(),
    id: z.string(),
    lastEditedAt: z.string(),
    lastEditedByName: z.string().nullish(),
    lastEditedMcpClientName: z.string().nullish(),
    lastEditedVia: documentActorSchema,
    links: z.array(linkSchema).optional(),
    organizationId: z.string(),
    revision: z.number(),
    sourceType: documentSourceSchema,
    spaceId: z.string(),
    status: documentStatusSchema,
    tags: z.array(tagSchema).optional(),
    title: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const documentSummarySchema = documentSummaryBaseSchema.transform((document) =>
  toDocumentSummary(document),
);

const documentDetailSchema = documentSummaryBaseSchema
  .extend({
    attachments: z
      .array(
        z
          .object({
            fileName: z.string(),
            id: z.string(),
            size: z.number().nullish(),
          })
          .passthrough(),
      )
      .optional(),
    comments: z
      .array(
        z
          .object({
            authorName: z.string().nullish(),
            body: z.string(),
            createdAt: z.string(),
            id: z.string(),
          })
          .passthrough(),
      )
      .optional(),
    contentMarkdown: z.string().catch(""),
    timeline: z
      .array(
        z
          .object({
            actorName: z.string().nullish(),
            changeType: z.string(),
            createdAt: z.string(),
            id: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .transform((document) => ({
    ...toDocumentSummary(document),
    attachments: document.attachments,
    comments: document.comments,
    contentMarkdown: document.contentMarkdown,
    timeline: document.timeline,
  }));

const documentPageSchema = z
  .object({
    items: z.array(documentSummarySchema),
    page: z.number().optional(),
    pageSize: z.number().optional(),
    total: z.number().catch(0),
  })
  .passthrough();

export async function listDocuments(
  input: ListDocumentsInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentPageResult<DocumentSummary>> {
  const {
    currentUserId,
    filter,
    organizationId: _organizationId,
    spaceId,
    ...query
  } = input;
  const response = await api.get<unknown>(`/spaces/${spaceId}/documents`, {
    query: normalizeTagApiQuery({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
      query: optionalString(query.query),
      ...toDocumentListFilterQuery(filter, currentUserId),
      tagIds: query.tagIds,
      tagMatch: query.tagMatch,
    }),
  });

  return documentPageSchema.parse(response.data);
}

export async function getDocument(
  input: { documentId: string; organizationId?: string; spaceId?: string },
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const response = await api.get<unknown>(`/documents/${input.documentId}`);

  return documentDetailSchema.parse(response.data);
}

export async function pasteDocument(
  context: { organizationId?: string; spaceId: string },
  input: PasteDocumentInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const { organizationId: _organizationId, spaceId } = context;
  const response = await api.post<unknown>(
    `/spaces/${spaceId}/documents/paste`,
    {
      contentMarkdown: input.contentMarkdown,
      sourceType: input.sourceType ?? "PASTE_MARKDOWN",
      tagIds: input.tagIds ?? [],
      title: input.title,
    },
  );

  return documentDetailSchema.parse(response.data);
}

export async function importMarkdownDocument(
  context: { organizationId?: string; spaceId: string },
  input: ImportDocumentInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  return importDocumentFile(
    `/spaces/${context.spaceId}/documents/import-markdown`,
    input,
    api,
  );
}

export async function importDocxDocument(
  context: { organizationId?: string; spaceId: string },
  input: ImportDocumentInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  return importDocumentFile(
    `/spaces/${context.spaceId}/documents/import-docx`,
    input,
    api,
  );
}

export async function updateDocument(
  input: { documentId: string } & UpdateDocumentInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const { contentMarkdown, documentId, linkTargets, ...metadata } = input;
  let document: DocumentDetail | null = null;

  if (
    metadata.title !== undefined ||
    metadata.tagIds !== undefined ||
    linkTargets !== undefined
  ) {
    const response = await api.patch<unknown>(
      `/documents/${documentId}/metadata`,
      {
        ...metadata,
        links: linkTargets,
      },
    );
    document = documentDetailSchema.parse(response.data);
  }

  if (contentMarkdown !== undefined) {
    const response = await api.patch<unknown>(`/documents/${documentId}/content`, {
      baseRevision: document?.revision ?? input.baseRevision,
      contentMarkdown,
    });
    document = documentDetailSchema.parse(response.data);
  }

  if (!document) {
    return getDocument({ documentId }, api);
  }

  return document;
}

export async function reimportDocument(
  input: { documentId: string } & ReimportDocumentInput,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const formData = new FormData();
  formData.set("baseRevision", String(input.baseRevision));
  formData.set("file", input.file, input.file.name);

  const response = await api.post<unknown>(
    `/documents/${input.documentId}/reimport`,
    formData,
  );

  return documentDetailSchema.parse(response.data);
}

export async function archiveDocument(
  documentId: string,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const response = await api.post<unknown>(`/documents/${documentId}/archive`);

  return documentDetailSchema.parse(response.data);
}

export async function restoreDocument(
  documentId: string,
  api: DocumentApiTransport = defaultApi,
): Promise<DocumentDetail> {
  const response = await api.post<unknown>(`/documents/${documentId}/restore`);

  return documentDetailSchema.parse(response.data);
}

export async function deleteDocument(
  documentId: string,
  api: DocumentApiTransport = defaultApi,
): Promise<void> {
  await api.delete<unknown>(`/documents/${documentId}`);
}

function importDocumentFile(
  path: string,
  input: ImportDocumentInput,
  api: DocumentApiTransport,
): Promise<DocumentDetail> {
  const formData = new FormData();
  formData.set("file", input.file, input.file.name);
  if (input.title?.trim()) {
    formData.set("title", input.title.trim());
  }

  return api
    .post<unknown>(path, formData)
    .then((response) => documentDetailSchema.parse(response.data));
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toDocumentSummary<TDocument extends { contentSnippet?: string | null; contentText?: string }>(
  document: TDocument,
) {
  return {
    ...document,
    contentSnippet:
      document.contentSnippet ?? createContentSnippet(document.contentText),
  };
}

function createContentSnippet(contentText: string | undefined) {
  const normalized = contentText?.replace(/\s+/gu, " ").trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function toDocumentListFilterQuery(
  filter: DocumentFilterKey | undefined,
  currentUserId: string | undefined,
) {
  switch (filter) {
    case "createdByMe":
      return currentUserId ? { createdById: currentUserId } : {};
    case "mcpCreated":
      return { sourceType: "MCP_CREATED" as const };
    case "recentMcpEdited":
      return { lastEditedVia: "MCP_CLIENT" as const };
    case "archived":
      return { status: "ARCHIVED" as const };
    case "all":
    default:
      return {};
  }
}
