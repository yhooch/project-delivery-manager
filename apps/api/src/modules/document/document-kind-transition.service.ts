import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import { formatDisplayCode as formatObjectDisplayCode } from "../object-code/object-code.types";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from "./document.repository";
import { toDocument } from "./document.mappers";
import type {
  CancelRequirementInput,
  ConvertDocumentToRequirementInput,
} from "./document.types";

const REQUIREMENT_DOCUMENT_KIND = "REQUIREMENT" as const;
const REQUIREMENT_CODE_PREFIX = "REQ" as const;

type PrismaDocumentRecord = Parameters<typeof toDocument>[0];
type RequirementReferenceClient = Pick<
  Prisma.TransactionClient,
  "intakeItem" | "objectParticipant" | "workItem"
>;

@Injectable()
export class DocumentKindTransitionService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ObjectCodeAllocator)
    private readonly objectCodeAllocator: ObjectCodeAllocator,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
  ) {}

  async convertToRequirement(input: ConvertDocumentToRequirementInput) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (existing.revision !== input.baseRevision) {
        return { status: "conflict" as const };
      }
      if (existing.kind !== "GENERAL") {
        return { status: "invalid_kind" as const };
      }

      const now = new Date();
      const activate = input.activate ?? true;
      const sequence = activate
        ? await this.objectCodeAllocator.allocateOne(tx, {
            actorUserId: input.actorUserId,
            objectType: "REQUIREMENT",
            organizationId: existing.organizationId,
            spaceId: existing.spaceId,
          })
        : null;
      const displayCode =
        sequence == null
          ? undefined
          : formatObjectDisplayCode("REQUIREMENT", sequence);
      const updated = await tx.document.update({
        data: {
          kind: REQUIREMENT_DOCUMENT_KIND,
          lastEditedAt: now,
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId ?? null,
          ownerId: input.ownerId ?? null,
          priority: input.priority ?? null,
          revision: existing.revision + 1,
          status: activate ? "ACTIVE" : "DRAFT",
          sequence,
          summary: input.summary ?? existing.summary,
          title: input.title ?? existing.title,
          updatedById: input.actorUserId,
          versionId: input.versionId ?? null,
        },
        where: {
          id: existing.id,
        },
      });

      if (sequence != null && displayCode) {
        await tx.documentCodeHistory.create({
          data: {
            id: ulid(),
            changedById: input.actorUserId,
            codePrefix: REQUIREMENT_CODE_PREFIX,
            codeStatus: "ASSIGNED",
            displayCode,
            documentId: updated.id,
            kind: REQUIREMENT_DOCUMENT_KIND,
            organizationId: updated.organizationId,
            requestId: input.requestId,
            sequence,
            spaceId: updated.spaceId,
          },
        });
      }
      if (input.ownerId) {
        await ensureAssigneeParticipant(tx, {
          actorUserId: input.actorUserId,
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          targetId: updated.id,
          userId: input.ownerId,
        });
      }
      await createTransitionRevision(tx, input, {
        ...toTransitionRevisionSnapshot(updated, "CONVERTED_TO_REQUIREMENT"),
        metadata: {
          displayCode,
          operation: "CONVERTED_TO_REQUIREMENT",
          sequence,
          status: updated.status,
        },
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          kind: updated.kind,
          revision: updated.revision,
          sequence,
          status: updated.status,
          versionId: updated.versionId,
        },
        before: {
          kind: existing.kind,
          revision: existing.revision,
          versionId: existing.versionId,
        },
        eventType: "UPDATED",
        metadata: {
          displayCode,
          operation: "CONVERTED_TO_REQUIREMENT",
        },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Document converted to requirement",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated" as const,
          document:
            (await this.documents.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }

  async cancelRequirementPreflight(documentId: string) {
    const existing = await this.prisma.client.document.findFirst({
      where: {
        deletedAt: null,
        id: documentId,
      },
    });

    if (!existing) {
      return { status: "not_found" as const };
    }
    if (existing.kind !== REQUIREMENT_DOCUMENT_KIND) {
      return { status: "invalid_kind" as const };
    }

    return {
      referenceCount: await countRequirementReferences(
        this.prisma.client,
        existing.id,
      ),
      status: "ok" as const,
    };
  }

  async cancelRequirement(input: CancelRequirementInput) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          deletedAt: null,
          id: input.documentId,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }
      if (existing.revision !== input.baseRevision) {
        return { status: "conflict" as const };
      }
      if (existing.kind !== REQUIREMENT_DOCUMENT_KIND) {
        return { status: "invalid_kind" as const };
      }

      const referenceCount = await countRequirementReferences(tx, existing.id);

      if (
        referenceCount > 0 &&
        input.referenceMode === "REJECT_IF_REFERENCED"
      ) {
        return { referenceCount, status: "referenced" as const };
      }

      const now = new Date();

      if (referenceCount > 0) {
        await unlinkRequirementReferences(tx, {
          actorUserId: input.actorUserId,
          documentId: existing.id,
          now,
        });
      }
      await softDeleteRequirementAssignees(tx, {
        actorUserId: input.actorUserId,
        documentId: existing.id,
        now,
      });

      const updated = await tx.document.update({
        data: {
          kind: "GENERAL",
          lastEditedAt: now,
          lastEditedById: input.actorUserId,
          lastEditedVia: input.actorType,
          lastEditedMcpClientId: input.mcpClientId ?? null,
          ownerId: null,
          priority: null,
          revision: existing.revision + 1,
          sequence: null,
          updatedById: input.actorUserId,
          versionId: null,
        },
        where: {
          id: existing.id,
        },
      });

      await tx.documentCodeHistory.updateMany({
        data: {
          changedById: input.actorUserId,
          codeStatus: "CANCELLED",
          reason: input.reason ?? "Requirement cancelled",
          requestId: input.requestId,
          statusChangedAt: now,
        },
        where: {
          codeStatus: "ASSIGNED",
          documentId: existing.id,
          kind: REQUIREMENT_DOCUMENT_KIND,
          organizationId: existing.organizationId,
          spaceId: existing.spaceId,
        },
      });
      await createTransitionRevision(tx, input, {
        ...toTransitionRevisionSnapshot(updated, "CANCELLED_REQUIREMENT"),
        metadata: {
          operation: "CANCELLED_REQUIREMENT",
          previousOwnerId: existing.ownerId,
          previousPriority: existing.priority,
          previousSequence: existing.sequence,
          previousVersionId: existing.versionId,
          referenceCount,
          referenceMode: input.referenceMode,
          reason: input.reason,
        },
      });
      await createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          kind: updated.kind,
          referenceMode: input.referenceMode,
          revision: updated.revision,
        },
        before: {
          kind: existing.kind,
          revision: existing.revision,
          sequence: existing.sequence,
        },
        eventType: "UPDATED",
        metadata: {
          operation: "CANCELLED_REQUIREMENT",
          referenceCount,
          referenceMode: input.referenceMode,
          reason: input.reason,
        },
        organizationId: updated.organizationId,
        spaceId: updated.spaceId,
        targetId: updated.id,
        targetType: "DOCUMENT",
        title: "Requirement cancelled",
      });

      return { status: "updated" as const, document: updated };
    });

    return result.status === "updated"
      ? {
          status: "updated" as const,
          document:
            (await this.documents.findById(result.document.id)) ??
            toDocument(result.document),
        }
      : result;
  }
}

async function countRequirementReferences(
  client: RequirementReferenceClient,
  documentId: string,
) {
  const [intakeItems, workItems] = await Promise.all([
    client.intakeItem.count({
      where: {
        deletedAt: null,
        requirementId: documentId,
      },
    }),
    client.workItem.count({
      where: {
        deletedAt: null,
        requirementId: documentId,
      },
    }),
  ]);

  return intakeItems + workItems;
}

async function ensureAssigneeParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
    targetId: string;
    userId: string;
  },
) {
  const existing = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: "ASSIGNEE",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "DOCUMENT",
      userId: input.userId,
    },
  });

  if (existing) {
    return;
  }

  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.actorUserId,
      organizationId: input.organizationId,
      relationType: "ASSIGNEE",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "DOCUMENT",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

async function softDeleteRequirementAssignees(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    documentId: string;
    now: Date;
  },
) {
  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: input.now,
      updatedById: input.actorUserId,
    },
    where: {
      deletedAt: null,
      relationType: "ASSIGNEE",
      targetId: input.documentId,
      targetType: "DOCUMENT",
    },
  });
}

async function unlinkRequirementReferences(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    documentId: string;
    now: Date;
  },
) {
  const [intakeItems, workItems] = await Promise.all([
    tx.intakeItem.findMany({
      select: {
        id: true,
        organizationId: true,
        requirementId: true,
        sourceObject: true,
        spaceId: true,
        title: true,
      },
      where: {
        deletedAt: null,
        requirementId: input.documentId,
      },
    }),
    tx.workItem.findMany({
      select: {
        id: true,
        organizationId: true,
        requirementId: true,
        spaceId: true,
        title: true,
        type: true,
      },
      where: {
        deletedAt: null,
        requirementId: input.documentId,
      },
    }),
  ]);

  await tx.$executeRaw`
    UPDATE "intake_items"
    SET
      "source_object" = CASE
        WHEN "source_object" IS NULL THEN NULL
        ELSE ("source_object" - 'requirementId') || jsonb_build_object(
          'previousRequirementId', ${input.documentId},
          'requirementUnlinkedAt', ${input.now.toISOString()},
          'requirementUnlinkedById', ${input.actorUserId}
        )
      END,
      "updated_by_id" = ${input.actorUserId},
      "updated_at" = ${input.now}
    WHERE "deleted_at" IS NULL
      AND "requirement_id" = ${input.documentId}
      AND "source_object" ? 'requirementId'
  `;
  await Promise.all([
    tx.intakeItem.updateMany({
      data: {
        requirementId: null,
        updatedById: input.actorUserId,
      },
      where: {
        deletedAt: null,
        requirementId: input.documentId,
      },
    }),
    tx.workItem.updateMany({
      data: {
        requirementId: null,
        updatedById: input.actorUserId,
      },
      where: {
        deletedAt: null,
        requirementId: input.documentId,
      },
    }),
  ]);
  await Promise.all([
    ...intakeItems.map((item) =>
      createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          requirementId: null,
        },
        before: {
          requirementId: item.requirementId,
        },
        eventType: "UPDATED",
        metadata: {
          operation: "REQUIREMENT_REFERENCE_UNLINKED",
          previousRequirementId: input.documentId,
        },
        organizationId: item.organizationId,
        spaceId: item.spaceId,
        targetId: item.id,
        targetType: "INTAKE_ITEM",
        title: "Requirement reference unlinked",
      }),
    ),
    ...workItems.map((item) =>
      createTimelineEventRecord(tx, {
        actorUserId: input.actorUserId,
        after: {
          requirementId: null,
        },
        before: {
          requirementId: item.requirementId,
        },
        eventType: "UPDATED",
        metadata: {
          operation: "REQUIREMENT_REFERENCE_UNLINKED",
          previousRequirementId: input.documentId,
        },
        organizationId: item.organizationId,
        spaceId: item.spaceId,
        targetId: item.id,
        targetType: "WORK_ITEM",
        targetWorkItemType: item.type,
        title: "Requirement reference unlinked",
      }),
    ),
  ]);
}

async function createTransitionRevision(
  tx: Prisma.TransactionClient,
  actor: {
    actorType: ConvertDocumentToRequirementInput["actorType"];
    actorUserId: string;
    mcpClientId?: string;
    requestId?: string;
  },
  input: {
    changeType: Prisma.DocumentRevisionCreateInput["changeType"];
    contentFormat: Prisma.DocumentRevisionCreateInput["contentFormat"];
    contentJson: unknown;
    contentMarkdown: string | null;
    contentMarkdownCache: string | null;
    contentText: string;
    documentId: string;
    kind: Prisma.DocumentRevisionCreateInput["kind"];
    metadata: Prisma.InputJsonValue;
    organizationId: string;
    revision: number;
    spaceId: string;
    summary: string | null;
    title: string;
  },
) {
  await tx.documentRevision.create({
    data: {
      id: ulid(),
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      documentId: input.documentId,
      revision: input.revision,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      contentFormat: input.contentFormat,
      contentJson:
        input.contentFormat === "TIPTAP_JSON"
          ? toPrismaJson(input.contentJson)
          : Prisma.DbNull,
      contentMarkdown: input.contentMarkdown,
      contentMarkdownCache:
        input.contentFormat === "TIPTAP_JSON"
          ? input.contentMarkdownCache
          : null,
      contentText: input.contentText,
      changeType: input.changeType,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      mcpClientId: actor.mcpClientId,
      requestId: actor.requestId,
      metadata: input.metadata,
    },
  });
}

function toTransitionRevisionSnapshot(
  document: PrismaDocumentRecord,
  changeType: Prisma.DocumentRevisionCreateInput["changeType"],
) {
  return {
    changeType,
    contentFormat: document.contentFormat,
    contentJson: document.contentJson,
    contentMarkdown: document.contentMarkdown,
    contentMarkdownCache: document.contentMarkdownCache,
    contentText: document.contentText,
    documentId: document.id,
    kind: document.kind,
    organizationId: document.organizationId,
    revision: document.revision,
    spaceId: document.spaceId,
    summary: document.summary,
    title: document.title,
  };
}

function toPrismaJson(value: unknown) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}
