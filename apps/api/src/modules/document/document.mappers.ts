import type {
  Document,
  DocumentActorType,
  DocumentAttachmentOverview,
  DocumentChangeType,
  DocumentChunk,
  DocumentCommentOverview,
  DocumentDetail,
  DocumentFolder,
  DocumentFolderPathItem,
  DocumentLink,
  DocumentLinkTargetType,
  DocumentRevision,
  DocumentSourceType,
  DocumentStatus,
  DocumentTimelineOverview,
  TagDto,
  TimelineEventType,
  WorkItemType,
} from "@project-delivery/shared";

type PrismaDocumentRecord = {
  archivedAt: Date | null;
  contentMarkdown: string;
  contentText: string;
  createdAt: Date;
  createdById: string | null;
  createdMcpClientId: string | null;
  createdVia: DocumentActorType;
  deletedAt: Date | null;
  folderId: string | null;
  id: string;
  lastEditedAt: Date;
  lastEditedById: string;
  lastEditedMcpClientId: string | null;
  lastEditedVia: DocumentActorType;
  organizationId: string;
  revision: number;
  sourceAttachmentId: string | null;
  sourceType: DocumentSourceType;
  spaceId: string;
  status: DocumentStatus;
  title: string;
  updatedAt: Date;
};

type PrismaDocumentFolderRecord = {
  createdAt: Date;
  createdById: string;
  deletedAt: Date | null;
  depth: number;
  id: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  sortOrder: number;
  spaceId: string;
  updatedAt: Date;
  updatedById: string;
  version: number;
};

export type DocumentActorDisplayContext = {
  createdByName?: string;
  createdMcpClientName?: string;
  lastEditedByName?: string;
  lastEditedMcpClientName?: string;
};

type PrismaDocumentRevisionRecord = {
  actorType: DocumentActorType;
  actorUserId: string;
  changeType: DocumentChangeType;
  contentMarkdown: string;
  contentText: string;
  createdAt: Date;
  documentId: string;
  id: string;
  mcpClientId: string | null;
  organizationId: string;
  requestId: string | null;
  revision: number;
  spaceId: string;
  title: string;
};

type PrismaDocumentLinkRecord = {
  createdAt: Date;
  createdById: string;
  deletedAt: Date | null;
  displayCode?: string | null;
  documentId: string;
  id: string;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: DocumentLinkTargetType;
  title?: string | null;
  workItemType?: WorkItemType | null;
};

type PrismaDocumentChunkRecord = {
  contentText: string;
  createdAt: Date;
  documentId: string;
  headingPath: string | null;
  id: string;
  ordinal: number;
  organizationId: string;
  revision: number;
  spaceId: string;
};

type PrismaDocumentCommentOverviewRecord = {
  author: {
    name: string;
    username: string;
  };
  body: string;
  createdAt: Date;
  id: string;
};

type PrismaDocumentAttachmentOverviewRecord = {
  fileName: string;
  id: string;
  size: number;
};

type PrismaDocumentTimelineOverviewRecord = {
  actor: {
    name: string;
    username: string;
  };
  createdAt: Date;
  eventType: TimelineEventType;
  id: string;
  title: string;
};

export function toDocument(
  record: PrismaDocumentRecord,
  input: {
    chunks?: PrismaDocumentChunkRecord[];
    folderPath?: DocumentFolderPathItem[];
    links?: PrismaDocumentLinkRecord[];
    tags?: TagDto[];
  } & DocumentActorDisplayContext = {},
): Document {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    folderId: record.folderId ?? undefined,
    folderPath: input.folderPath,
    title: record.title,
    contentMarkdown: record.contentMarkdown,
    contentText: record.contentText,
    sourceType: record.sourceType,
    sourceAttachmentId: record.sourceAttachmentId ?? undefined,
    status: record.status,
    revision: record.revision,
    createdById: record.createdById ?? record.lastEditedById,
    createdByName: input.createdByName,
    createdVia: record.createdVia,
    createdMcpClientId: record.createdMcpClientId ?? undefined,
    createdMcpClientName: input.createdMcpClientName,
    lastEditedById: record.lastEditedById,
    lastEditedByName: input.lastEditedByName,
    lastEditedVia: record.lastEditedVia,
    lastEditedMcpClientId: record.lastEditedMcpClientId ?? undefined,
    lastEditedMcpClientName: input.lastEditedMcpClientName,
    lastEditedAt: record.lastEditedAt.toISOString(),
    archivedAt: record.archivedAt?.toISOString(),
    deletedAt: record.deletedAt?.toISOString(),
    tags: input.tags,
    links: input.links?.map(toDocumentLink),
    chunks: input.chunks?.map(toDocumentChunk),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function toDocumentFolder(
  record: PrismaDocumentFolderRecord,
): DocumentFolder {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    parentId: record.parentId ?? undefined,
    name: record.name,
    sortOrder: record.sortOrder,
    depth: record.depth,
    version: record.version,
    createdById: record.createdById,
    updatedById: record.updatedById,
    deletedAt: record.deletedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function toDocumentDetail(
  record: PrismaDocumentRecord,
  input: {
    attachments?: PrismaDocumentAttachmentOverviewRecord[];
    chunks?: PrismaDocumentChunkRecord[];
    comments?: PrismaDocumentCommentOverviewRecord[];
    links?: PrismaDocumentLinkRecord[];
    tags?: TagDto[];
    timeline?: PrismaDocumentTimelineOverviewRecord[];
  } = {},
): DocumentDetail {
  return {
    ...toDocument(record, input),
    attachments: (input.attachments ?? []).map(toDocumentAttachmentOverview),
    comments: (input.comments ?? []).map(toDocumentCommentOverview),
    timeline: (input.timeline ?? []).map(toDocumentTimelineOverview),
  };
}

export function toDocumentRevision(
  record: PrismaDocumentRevisionRecord,
): DocumentRevision {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    documentId: record.documentId,
    revision: record.revision,
    title: record.title,
    contentMarkdown: record.contentMarkdown,
    contentText: record.contentText,
    changeType: record.changeType,
    actorType: record.actorType,
    actorUserId: record.actorUserId,
    mcpClientId: record.mcpClientId ?? undefined,
    requestId: record.requestId ?? undefined,
    createdAt: record.createdAt.toISOString(),
  });
}

export function toDocumentLink(record: PrismaDocumentLinkRecord): DocumentLink {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    documentId: record.documentId,
    targetType: record.targetType,
    targetId: record.targetId,
    displayCode: record.displayCode ?? undefined,
    title: record.title ?? undefined,
    workItemType: record.workItemType ?? undefined,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString(),
  });
}

export function toDocumentChunk(record: PrismaDocumentChunkRecord): DocumentChunk {
  return removeUndefined({
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    documentId: record.documentId,
    revision: record.revision,
    ordinal: record.ordinal,
    headingPath: record.headingPath ?? undefined,
    contentText: record.contentText,
    createdAt: record.createdAt.toISOString(),
  });
}

function toDocumentCommentOverview(
  record: PrismaDocumentCommentOverviewRecord,
): DocumentCommentOverview {
  return removeUndefined({
    id: record.id,
    authorName: nonEmptyString(record.author.name) ?? record.author.username,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
  });
}

function toDocumentAttachmentOverview(
  record: PrismaDocumentAttachmentOverviewRecord,
): DocumentAttachmentOverview {
  return {
    id: record.id,
    fileName: record.fileName,
    size: record.size,
  };
}

function toDocumentTimelineOverview(
  record: PrismaDocumentTimelineOverviewRecord,
): DocumentTimelineOverview {
  return removeUndefined({
    id: record.id,
    actorName: nonEmptyString(record.actor.name) ?? record.actor.username,
    changeType: nonEmptyString(record.title) ?? record.eventType,
    createdAt: record.createdAt.toISOString(),
  });
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
