import type {
  Document,
  DocumentDetail,
  DocumentLink,
} from "@project-delivery/shared";

import type {
  CreateDocumentInput,
  DocumentChunkListResult,
  DocumentLinkListResult,
  DocumentListInput,
  DocumentListResult,
  DocumentMutationResult,
  DocumentRevisionListResult,
  ReplaceDocumentLinksInput,
  UpdateDocumentContentInput,
  UpdateDocumentMetadataInput,
  UpdateDocumentStateInput,
} from "./document.types";

export const DOCUMENT_REPOSITORY = Symbol("DOCUMENT_REPOSITORY");

export type DocumentRepository = {
  create(input: CreateDocumentInput): Promise<Document>;
  findById(documentId: string): Promise<Document | undefined>;
  findDetailById(documentId: string): Promise<DocumentDetail | undefined>;
  list(input: DocumentListInput): Promise<DocumentListResult>;
  listChunks(input: {
    documentId: string;
    page: number;
    pageSize: number;
  }): Promise<DocumentChunkListResult>;
  listLinks(documentId: string): Promise<DocumentLink[]>;
  listLinksByTarget(input: {
    organizationId: string;
    page: number;
    pageSize: number;
    spaceId: string;
    targetId: string;
    targetType: DocumentLink["targetType"];
  }): Promise<DocumentLinkListResult>;
  listRevisions(input: {
    documentId: string;
    page: number;
    pageSize: number;
  }): Promise<DocumentRevisionListResult>;
  replaceLinks(input: ReplaceDocumentLinksInput): Promise<DocumentMutationResult>;
  updateContent(input: UpdateDocumentContentInput): Promise<DocumentMutationResult>;
  updateMetadata(
    input: UpdateDocumentMetadataInput,
  ): Promise<DocumentMutationResult>;
  updateState(input: UpdateDocumentStateInput): Promise<DocumentMutationResult>;
};
