import type { DocumentFolder } from "@project-delivery/shared";

import type {
  CreateDocumentFolderInput,
  DeleteDocumentFolderInput,
  DocumentFolderMutationResult,
  DocumentFolderTreeMutationResult,
  DocumentFolderTreeResult,
  MoveDocumentFolderInput,
  ReorderDocumentFolderInput,
  ReorderDocumentFoldersInput,
  UpdateDocumentFolderInput,
} from "./document.types";

export const DOCUMENT_FOLDER_REPOSITORY = Symbol("DOCUMENT_FOLDER_REPOSITORY");

export type DocumentFolderRepository = {
  create(input: CreateDocumentFolderInput): Promise<DocumentFolderMutationResult>;
  delete(input: DeleteDocumentFolderInput): Promise<DocumentFolderMutationResult>;
  findById(folderId: string): Promise<DocumentFolder | undefined>;
  listDescendantIds(folderId: string): Promise<string[]>;
  listTree(input: {
    organizationId: string;
    spaceId: string;
  }): Promise<DocumentFolderTreeResult>;
  move(input: MoveDocumentFolderInput): Promise<DocumentFolderMutationResult>;
  reorder(input: ReorderDocumentFolderInput): Promise<DocumentFolderMutationResult>;
  reorderMany(
    input: ReorderDocumentFoldersInput,
  ): Promise<DocumentFolderTreeMutationResult>;
  update(input: UpdateDocumentFolderInput): Promise<DocumentFolderMutationResult>;
};
