import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  CreateDocumentFolderRequest,
  DocumentFolder,
  MoveDocumentFolderRequest,
  ReorderDocumentFolderRequest,
  ReorderDocumentFoldersRequest,
  SpaceRole,
  UpdateDocumentFolderRequest,
} from "@project-delivery/shared";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import { AuditService } from "../audit/audit.service";
import type { RequestMetadata } from "../auth/auth-session.types";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from "../space/space.repository";
import {
  DOCUMENT_FOLDER_REPOSITORY,
  type DocumentFolderRepository,
} from "./document-folder.repository";
import type {
  DocumentFolderMutationResult,
  DocumentFolderTreeMutationResult,
} from "./document.types";

const DOCUMENT_FOLDER_WRITER_DENIED_ROLES = new Set<SpaceRole>(["VIEWER"]);
const DOCUMENT_FOLDER_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

@Injectable()
export class DocumentFolderService {
  private readonly logger = new Logger(DocumentFolderService.name);

  constructor(
    @Inject(DOCUMENT_FOLDER_REPOSITORY)
    private readonly folders: DocumentFolderRepository,
    @Inject(SPACE_REPOSITORY)
    private readonly spaces: SpaceRepository,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(RealtimePublisherService)
    private readonly realtime: RealtimePublisherService,
  ) {}

  async list(
    actorUserId: string,
    spaceId: string,
    _input?: { includeDescendants?: boolean; includeDocumentCounts?: boolean },
  ) {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    return this.folders.listTree({
      organizationId: access.space.organizationId,
      spaceId,
    });
  }

  async create(
    actorUserId: string,
    spaceId: string,
    input: CreateDocumentFolderRequest,
    metadata: RequestMetadata = {},
  ): Promise<DocumentFolder> {
    const access = await this.requireFolderCreator(actorUserId, spaceId);
    const normalized = normalizeDocumentFolderName(input.name);
    const result = await this.folders.create({
      createdById: actorUserId,
      id: ulid(),
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      organizationId: access.space.organizationId,
      parentId: input.parentId,
      sortOrder: input.sortOrder,
      spaceId,
    });
    const folder = this.requireFolderMutationResult(result);

    await this.recordFolderAudit("CREATE", actorUserId, folder, undefined, metadata);
    this.publishFolderRealtime(actorUserId, folder, "CREATED");

    return folder;
  }

  async update(
    actorUserId: string,
    folderId: string,
    input: UpdateDocumentFolderRequest,
    metadata: RequestMetadata = {},
  ): Promise<DocumentFolder> {
    const existing = await this.requireOwnedOrManagerFolder(actorUserId, folderId);
    const normalized = normalizeDocumentFolderName(input.name ?? existing.name);
    const result = await this.folders.update({
      folderId,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      updatedById: actorUserId,
      version: input.version,
    });
    const updated = this.requireFolderMutationResult(result);

    await this.recordFolderAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishFolderRealtime(actorUserId, updated, "UPDATED");

    return updated;
  }

  async move(
    actorUserId: string,
    folderId: string,
    input: MoveDocumentFolderRequest,
    metadata: RequestMetadata = {},
  ): Promise<DocumentFolder> {
    const existing = await this.requireManagerFolder(actorUserId, folderId);
    const result = await this.folders.move({
      folderId,
      parentId: input.parentId ?? undefined,
      sortOrder: input.sortOrder,
      updatedById: actorUserId,
      version: input.version,
    });
    const updated = this.requireFolderMutationResult(result);

    await this.recordFolderAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishFolderRealtime(actorUserId, updated, "UPDATED");

    return updated;
  }

  async reorder(
    actorUserId: string,
    folderId: string,
    input: ReorderDocumentFolderRequest,
    metadata: RequestMetadata = {},
  ): Promise<DocumentFolder> {
    const existing = await this.requireManagerFolder(actorUserId, folderId);
    const result = await this.folders.reorder({
      folderId,
      sortOrder: input.sortOrder,
      updatedById: actorUserId,
      version: input.version,
    });
    const updated = this.requireFolderMutationResult(result);

    await this.recordFolderAudit("UPDATE", actorUserId, updated, existing, metadata);
    this.publishFolderRealtime(actorUserId, updated, "UPDATED");

    return updated;
  }

  async reorderMany(
    actorUserId: string,
    spaceId: string,
    input: ReorderDocumentFoldersRequest,
    metadata: RequestMetadata = {},
  ) {
    const access = await this.requireFolderManagerInSpace(actorUserId, spaceId);
    const result = await this.folders.reorderMany({
      orderedFolderIds: input.orderedFolderIds,
      organizationId: access.space.organizationId,
      parentId: input.parentId ?? undefined,
      spaceId,
      updatedById: actorUserId,
    });
    const tree = this.requireFolderTreeMutationResult(result);

    await this.audit.record({
      actionType: "UPDATE",
      actorId: actorUserId,
      after: {
        operation: "DOCUMENT_FOLDERS_REORDERED",
        orderedFolderIds: input.orderedFolderIds,
        parentId: input.parentId ?? null,
      },
      before: undefined,
      ...metadata,
      organizationId: access.space.organizationId,
      spaceId,
      targetId: spaceId,
      targetType: "SPACE",
    });
    this.publishFolderTreeRealtime(actorUserId, {
      organizationId: access.space.organizationId,
      parentId: input.parentId ?? undefined,
      spaceId,
    });

    return tree;
  }

  async delete(
    actorUserId: string,
    folderId: string,
    metadata: RequestMetadata = {},
  ): Promise<Record<string, never>> {
    const existing = await this.requireOwnedOrManagerFolder(actorUserId, folderId);
    const result = await this.folders.delete({
      folderId,
      updatedById: actorUserId,
    });
    const deleted = this.requireFolderMutationResult(result);

    await this.recordFolderAudit("DELETE", actorUserId, deleted, existing, metadata);
    this.publishFolderRealtime(actorUserId, deleted, "DELETED");

    return {};
  }

  async requireFolderInSpace(
    folderId: string,
    input: { organizationId: string; spaceId: string },
  ): Promise<DocumentFolder> {
    const folder = await this.folders.findById(folderId);

    if (!folder) {
      throwDocumentFolderNotFound();
    }
    if (
      folder.organizationId !== input.organizationId ||
      folder.spaceId !== input.spaceId
    ) {
      throwDocumentFolderCrossSpaceDenied();
    }

    return folder;
  }

  private async requireOwnedOrManagerFolder(
    actorUserId: string,
    folderId: string,
  ): Promise<DocumentFolder> {
    const { access, folder } = await this.requireFolderAccess(actorUserId, folderId);

    if (
      DOCUMENT_FOLDER_MANAGER_ROLES.has(access.role) ||
      folder.createdById === actorUserId
    ) {
      return folder;
    }

    throwDocumentFolderAccessDenied();
  }

  private async requireManagerFolder(
    actorUserId: string,
    folderId: string,
  ): Promise<DocumentFolder> {
    const { access, folder } = await this.requireFolderAccess(actorUserId, folderId);

    if (DOCUMENT_FOLDER_MANAGER_ROLES.has(access.role)) {
      return folder;
    }

    throwDocumentFolderAccessDenied();
  }

  private async requireFolderAccess(actorUserId: string, folderId: string) {
    const folder = await this.folders.findById(folderId);

    if (!folder) {
      throwDocumentFolderNotFound();
    }

    const access = await this.requireSpaceReader(actorUserId, folder.spaceId);

    return { access, folder };
  }

  private async requireSpaceReader(actorUserId: string, spaceId: string) {
    const access = await this.spaces.findAccessibleById(actorUserId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireFolderCreator(actorUserId: string, spaceId: string) {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    if (DOCUMENT_FOLDER_WRITER_DENIED_ROLES.has(access.role)) {
      throwDocumentFolderAccessDenied();
    }

    return access;
  }

  private async requireFolderManagerInSpace(actorUserId: string, spaceId: string) {
    const access = await this.requireSpaceReader(actorUserId, spaceId);

    if (!DOCUMENT_FOLDER_MANAGER_ROLES.has(access.role)) {
      throwDocumentFolderAccessDenied();
    }

    return access;
  }

  private requireFolderMutationResult(
    result: DocumentFolderMutationResult,
  ): DocumentFolder {
    if (result.status === "updated") {
      return result.folder;
    }

    throwFolderMutationStatus(result.status);
  }

  private requireFolderTreeMutationResult(
    result: DocumentFolderTreeMutationResult,
  ) {
    if (result.status === "updated") {
      return result.tree;
    }

    throwFolderMutationStatus(result.status);
  }

  private async recordFolderAudit(
    actionType: "CREATE" | "DELETE" | "UPDATE",
    actorUserId: string,
    after: DocumentFolder,
    before: DocumentFolder | undefined,
    metadata: RequestMetadata,
  ) {
    await this.audit.record({
      actionType,
      actorId: actorUserId,
      after,
      before,
      ...metadata,
      organizationId: after.organizationId,
      spaceId: after.spaceId,
      targetId: after.id,
      targetType: "DOCUMENT_FOLDER",
    });
  }

  private publishFolderRealtime(
    actorUserId: string,
    folder: DocumentFolder,
    operation: Parameters<RealtimePublisherService["publish"]>[0]["operation"],
  ) {
    try {
      this.realtime.publish({
        actorId: actorUserId,
        organizationId: folder.organizationId,
        spaceId: folder.spaceId,
        target: { type: "SPACE", id: folder.spaceId },
        operation,
        invalidates: ["document-directory"],
        hints: {
          targetType: "SPACE",
          targetId: folder.spaceId,
          spaceId: folder.spaceId,
          folderId: folder.id,
          changedFields: ["documentFolders"],
        },
      });
    } catch (error) {
      this.logger.error(
        "Failed to publish document folder realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private publishFolderTreeRealtime(
    actorUserId: string,
    input: {
      organizationId: string;
      parentId?: string;
      spaceId: string;
    },
  ) {
    try {
      this.realtime.publish({
        actorId: actorUserId,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        target: { type: "SPACE", id: input.spaceId },
        operation: "UPDATED",
        invalidates: ["document-directory"],
        hints: {
          targetType: "SPACE",
          targetId: input.spaceId,
          spaceId: input.spaceId,
          ...(input.parentId ? { folderId: input.parentId } : {}),
          changedFields: ["documentFolders"],
        },
      });
    } catch (error) {
      this.logger.error(
        "Failed to publish document folder tree realtime event",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function normalizeDocumentFolderName(name: string) {
  const normalizedName = name.trim().replaceAll(/\s+/gu, " ");

  return {
    name: normalizedName,
    normalizedName: normalizedName.toLocaleLowerCase(),
  };
}

function throwFolderMutationStatus(
  status: Exclude<DocumentFolderMutationResult["status"], "updated">,
): never {
  switch (status) {
    case "cross_space":
      return throwDocumentFolderCrossSpaceDenied();
    case "cycle":
      throw new ApiException(
        "DOCUMENT_FOLDER_MOVE_CYCLE",
        "Document folder cannot be moved into itself or its descendants",
        HttpStatus.CONFLICT,
      );
    case "depth_exceeded":
      throw new ApiException(
        "DOCUMENT_FOLDER_DEPTH_EXCEEDED",
        "Document folder depth exceeds limit",
        HttpStatus.BAD_REQUEST,
      );
    case "name_conflict":
      throw new ApiException(
        "DOCUMENT_FOLDER_NAME_CONFLICT",
        "Document folder name already exists",
        HttpStatus.CONFLICT,
      );
    case "not_empty":
      throw new ApiException(
        "DOCUMENT_FOLDER_NOT_EMPTY",
        "Document folder is not empty",
        HttpStatus.CONFLICT,
      );
    case "not_found":
      return throwDocumentFolderNotFound();
    case "version_conflict":
      throw new ApiException(
        "DOCUMENT_FOLDER_VERSION_CONFLICT",
        "Document folder version conflict",
        HttpStatus.CONFLICT,
      );
  }
}

function throwDocumentFolderNotFound(): never {
  throw new ApiException(
    "DOCUMENT_FOLDER_NOT_FOUND",
    "Document folder not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwDocumentFolderCrossSpaceDenied(): never {
  throw new ApiException(
    "DOCUMENT_FOLDER_CROSS_SPACE_DENIED",
    "Document folder belongs to another space",
    HttpStatus.BAD_REQUEST,
  );
}

function throwDocumentFolderAccessDenied(): never {
  throw new ApiException(
    "DOCUMENT_FOLDER_ACCESS_DENIED",
    "Document folder access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}
