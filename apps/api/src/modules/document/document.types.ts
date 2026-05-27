import type {
  Document,
  DocumentActorType,
  DocumentChangeType,
  DocumentChunk,
  DocumentLink,
  DocumentLinkTarget,
  DocumentRevision,
  DocumentSourceType,
  DocumentStatus,
  PageResult,
  TagDto,
} from "@project-delivery/shared";

import type { DocumentContentChunkInput } from "./document-content";

export type DocumentActorInput = {
  actorUserId: string;
  actorType: DocumentActorType;
  mcpClientId?: string;
  requestId?: string;
};

export type DocumentSourceAttachmentInput = {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type CreateDocumentInput = DocumentActorInput & {
  id: string;
  organizationId: string;
  spaceId: string;
  title: string;
  contentMarkdown: string;
  contentText: string;
  sourceType: DocumentSourceType;
  sourceAttachment?: DocumentSourceAttachmentInput;
  tagIds?: string[];
  links?: DocumentLinkTarget[];
  chunks: DocumentContentChunkInput[];
};

export type DocumentListInput = {
  organizationId: string;
  spaceId: string;
  page: number;
  pageSize: number;
  query?: string;
  status?: DocumentStatus;
  sourceType?: DocumentSourceType;
  lastEditedVia?: DocumentActorType;
  createdById?: string;
  tagIds?: string;
  tagMatch?: "ANY" | "ALL";
  linkedTargetType?: DocumentLinkTarget["targetType"];
  linkedTargetId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type UpdateDocumentMetadataInput = DocumentActorInput & {
  documentId: string;
  baseRevision?: number;
  title?: string;
  tagIds?: string[];
  links?: DocumentLinkTarget[];
};

export type UpdateDocumentContentInput = DocumentActorInput & {
  documentId: string;
  baseRevision: number;
  contentMarkdown: string;
  contentText: string;
  changeType: Extract<
    DocumentChangeType,
    "CONTENT_EDITED" | "CONTENT_APPENDED" | "CONTENT_REPLACED" | "REIMPORTED"
  >;
  chunks: DocumentContentChunkInput[];
  sourceAttachment?: DocumentSourceAttachmentInput;
};

export type UpdateDocumentStateInput = DocumentActorInput & {
  documentId: string;
  changeType: Extract<DocumentChangeType, "ARCHIVED" | "RESTORED" | "DELETED">;
};

export type ReplaceDocumentLinksInput = DocumentActorInput & {
  baseRevision: number;
  documentId: string;
  links: DocumentLinkTarget[];
};

export type DocumentMutationResult =
  | {
      status: "updated";
      document: Document;
    }
  | {
      status: "conflict";
    }
  | {
      status: "not_found";
    };

export type DocumentListResult = PageResult<Document>;
export type DocumentRevisionListResult = PageResult<DocumentRevision>;
export type DocumentChunkListResult = PageResult<DocumentChunk>;
export type DocumentLinkListResult = PageResult<DocumentLink>;

export type DocumentRecordWithTags = Document & {
  tags?: TagDto[];
};
