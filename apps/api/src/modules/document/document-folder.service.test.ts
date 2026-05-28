import type { DocumentFolder } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import type { AuditService } from "../audit/audit.service";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { SpaceRepository } from "../space/space.repository";
import type { DocumentFolderRepository } from "./document-folder.repository";
import { DocumentFolderService } from "./document-folder.service";

const ACTOR_ID = "01H00000000000000000000001";
const OWNER_ID = "01H00000000000000000000002";
const ORGANIZATION_ID = "01H00000000000000000000003";
const SPACE_ID = "01H00000000000000000000004";
const FOLDER_ID = "01H00000000000000000000005";

describe("DocumentFolderService", () => {
  it("prevents VIEWER from creating folders", async () => {
    const { folders, service } = createSubject({ role: "VIEWER" });

    await expect(
      service.create(ACTOR_ID, SPACE_ID, {
        name: "Research",
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_FOLDER_ACCESS_DENIED",
    });
    expect(folders.create).not.toHaveBeenCalled();
  });

  it("creates folders with audit and directory invalidation", async () => {
    const folder = fakeFolder({ createdById: ACTOR_ID, name: "Research" });
    const { audit, folders, realtime, service } = createSubject({
      createResult: { status: "updated", folder },
    });

    await expect(
      service.create(
        ACTOR_ID,
        SPACE_ID,
        {
          name: "  Research  ",
          parentId: FOLDER_ID,
          sortOrder: 10,
        },
        { requestId: "req-folder-create" },
      ),
    ).resolves.toMatchObject({
      id: FOLDER_ID,
      name: "Research",
    });
    expect(folders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Research",
        normalizedName: "research",
        parentId: FOLDER_ID,
        sortOrder: 10,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        targetId: FOLDER_ID,
        targetType: "DOCUMENT_FOLDER",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidates: ["document-directory"],
        target: { type: "SPACE", id: SPACE_ID },
      }),
    );
  });

  it("allows only managers to move shared folders", async () => {
    const { folders, service } = createSubject({
      folder: fakeFolder({ createdById: ACTOR_ID }),
      role: "DEVELOPER",
    });

    await expect(
      service.move(ACTOR_ID, FOLDER_ID, {
        parentId: null,
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_FOLDER_ACCESS_DENIED",
    });
    expect(folders.move).not.toHaveBeenCalled();
  });

  it("allows only managers to reorder sibling folder trees", async () => {
    const { folders, service } = createSubject({
      role: "DEVELOPER",
    });

    await expect(
      service.reorderMany(ACTOR_ID, SPACE_ID, {
        orderedFolderIds: [FOLDER_ID],
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_FOLDER_ACCESS_DENIED",
    });
    expect(folders.reorderMany).not.toHaveBeenCalled();
  });

  it("reorders sibling folder trees with a single directory invalidation", async () => {
    const siblingId = "01H00000000000000000000006";
    const { audit, folders, realtime, service } = createSubject();

    await expect(
      service.reorderMany(
        ACTOR_ID,
        SPACE_ID,
        {
          parentId: null,
          orderedFolderIds: [siblingId, FOLDER_ID],
        },
        { requestId: "req-folder-reorder-many" },
      ),
    ).resolves.toEqual({ items: [] });
    expect(folders.reorderMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderedFolderIds: [siblingId, FOLDER_ID],
        organizationId: ORGANIZATION_ID,
        parentId: undefined,
        spaceId: SPACE_ID,
        updatedById: ACTOR_ID,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        targetId: SPACE_ID,
        targetType: "SPACE",
      }),
    );
    expect(realtime.publish).toHaveBeenCalledTimes(1);
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidates: ["document-directory"],
        target: { type: "SPACE", id: SPACE_ID },
      }),
    );
  });

  it("maps non-empty delete results to DOCUMENT_FOLDER_NOT_EMPTY", async () => {
    const { audit, service } = createSubject({
      deleteResult: { status: "not_empty" },
      folder: fakeFolder({ createdById: ACTOR_ID }),
      role: "DEVELOPER",
    });

    await expect(service.delete(ACTOR_ID, FOLDER_ID)).rejects.toMatchObject({
      code: "DOCUMENT_FOLDER_NOT_EMPTY",
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function createSubject(input: {
  createResult?: Awaited<ReturnType<DocumentFolderRepository["create"]>>;
  deleteResult?: Awaited<ReturnType<DocumentFolderRepository["delete"]>>;
  folder?: DocumentFolder;
  reorderManyResult?: Awaited<
    ReturnType<DocumentFolderRepository["reorderMany"]>
  >;
  role?: "DEVELOPER" | "PM" | "VIEWER";
} = {}) {
  const folder = input.folder ?? fakeFolder();
  const folders = {
    create: vi.fn(async () =>
      input.createResult ?? { status: "updated", folder },
    ),
    delete: vi.fn(async () =>
      input.deleteResult ?? { status: "updated", folder },
    ),
    findById: vi.fn(async () => folder),
    listDescendantIds: vi.fn(async () => []),
    listTree: vi.fn(async () => ({ items: [] })),
    move: vi.fn(async () => ({ status: "updated", folder })),
    reorder: vi.fn(async () => ({ status: "updated", folder })),
    reorderMany: vi.fn(async () =>
      input.reorderManyResult ?? { status: "updated", tree: { items: [] } },
    ),
    update: vi.fn(async () => ({ status: "updated", folder })),
  } as unknown as DocumentFolderRepository & Record<string, ReturnType<typeof vi.fn>>;
  const spaces = {
    findAccessibleById: vi.fn(async () => ({
      role: input.role ?? "PM",
      space: {
        id: SPACE_ID,
        organizationId: ORGANIZATION_ID,
        name: "Space",
        code: "SPACE",
        status: "ACTIVE",
        staleThresholdDays: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })),
  } as unknown as SpaceRepository;
  const audit = {
    record: vi.fn(),
  } as unknown as AuditService & {
    record: ReturnType<typeof vi.fn>;
  };
  const realtime = {
    publish: vi.fn(),
  } as unknown as RealtimePublisherService & {
    publish: ReturnType<typeof vi.fn>;
  };

  return {
    audit,
    folders,
    realtime,
    service: new DocumentFolderService(folders, spaces, audit, realtime),
    spaces,
  };
}

function fakeFolder(input: Partial<DocumentFolder> = {}): DocumentFolder {
  return {
    id: input.id ?? FOLDER_ID,
    organizationId: input.organizationId ?? ORGANIZATION_ID,
    spaceId: input.spaceId ?? SPACE_ID,
    parentId: input.parentId,
    name: input.name ?? "Folder",
    sortOrder: input.sortOrder ?? 0,
    depth: input.depth ?? 0,
    version: input.version ?? 1,
    createdById: input.createdById ?? OWNER_ID,
    updatedById: input.updatedById ?? OWNER_ID,
    createdAt: input.createdAt ?? "2026-05-27T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-05-27T00:00:00.000Z",
  };
}
