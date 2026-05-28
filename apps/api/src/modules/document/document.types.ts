import type {
  Document,
  DocumentActorType,
  DocumentChangeType,
  DocumentChunk,
  DocumentFolder,
  DocumentFolderTreeNode,
  DocumentListItem,
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
  folderId?: string;
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
  folderId?: string;
  includeDescendants?: boolean;
  unfiled?: boolean;
  tagIds?: string;
  tagMatch?: "ANY" | "ALL";
  linkedTargetType?: DocumentLinkTarget["targetType"];
  linkedTargetId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type SearchCurrentRevisionChunksInput = {
  documents: Array<{
    documentId: string;
    revision: number;
  }>;
  maxHitsPerDocument: number;
  organizationId: string;
  query: string;
  spaceId: string;
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

export type MoveDocumentToFolderInput = DocumentActorInput & {
  baseRevision?: number;
  documentId: string;
  folderId?: string;
};

export type MoveDocumentsToFolderInput = DocumentActorInput & {
  documentIds: string[];
  folderId?: string;
  organizationId: string;
  spaceId: string;
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

export type DocumentListResult = PageResult<DocumentListItem>;
export type DocumentRevisionListResult = PageResult<DocumentRevision>;
export type DocumentChunkListResult = PageResult<DocumentChunk>;
export type DocumentLinkListResult = PageResult<DocumentLink>;

export type DocumentRecordWithTags = Document & {
  tags?: TagDto[];
};

export type CreateDocumentFolderInput = {
  createdById: string;
  id: string;
  name: string;
  normalizedName: string;
  organizationId: string;
  parentId?: string;
  sortOrder?: number;
  spaceId: string;
};

export type UpdateDocumentFolderInput = {
  folderId: string;
  name: string;
  normalizedName: string;
  updatedById: string;
  version?: number;
};

export type MoveDocumentFolderInput = {
  folderId: string;
  parentId?: string;
  sortOrder?: number;
  updatedById: string;
  version?: number;
};

export type ReorderDocumentFolderInput = {
  folderId: string;
  sortOrder: number;
  updatedById: string;
  version?: number;
};

export type ReorderDocumentFoldersInput = {
  orderedFolderIds: string[];
  organizationId: string;
  parentId?: string;
  spaceId: string;
  updatedById: string;
};

export type DeleteDocumentFolderInput = {
  folderId: string;
  updatedById: string;
};

export type DocumentFolderTreeResult = {
  items: DocumentFolderTreeNode[];
};

export type DocumentBatchMutationResult =
  | {
      documents: Document[];
      status: "updated";
    }
  | {
      status: "not_found";
    };

export type DocumentFolderMutationResult =
  | {
      folder: DocumentFolder;
      status: "updated";
    }
  | {
      status:
        | "cross_space"
        | "cycle"
        | "depth_exceeded"
        | "name_conflict"
        | "not_empty"
        | "not_found"
        | "version_conflict";
    };

export type DocumentFolderTreeMutationResult =
  | {
      status: "updated";
      tree: DocumentFolderTreeResult;
    }
  | {
      status: "cross_space" | "not_found";
    };
