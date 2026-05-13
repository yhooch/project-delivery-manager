import type {
  AttachmentMimeType,
  AttachmentRef,
  Requirement,
  RequirementStatus,
} from "@project-delivery/shared";

type PrismaRequirementRecord = {
  contentFormat: "TIPTAP_JSON";
  contentJson: unknown;
  contentMarkdownCache: string | null;
  contentText: string | null;
  id: string;
  organizationId: string;
  ownerId: string | null;
  priority: Requirement["priority"] | null;
  spaceId: string;
  status: RequirementStatus;
  summary: string | null;
  title: string;
  versionId: string | null;
};

type PrismaAttachmentRefRecord = {
  fileKey: string;
  fileName: string;
  id: string;
  mimeType: string;
  size: number;
};

export function toRequirement(
  record: PrismaRequirementRecord,
  attachments: PrismaAttachmentRefRecord[] = [],
): Requirement {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    versionId: record.versionId ?? undefined,
    title: record.title,
    summary: record.summary ?? undefined,
    contentJson: toTiptapJson(record.contentJson),
    contentText: record.contentText ?? undefined,
    contentMarkdownCache: record.contentMarkdownCache ?? undefined,
    contentFormat: record.contentFormat,
    status: record.status,
    priority: record.priority ?? undefined,
    ownerId: record.ownerId ?? undefined,
    attachments: attachments.map(toAttachmentRef),
    relatedWorkItems: {
      taskCount: 0,
      bugCount: 0,
      tasks: [],
      bugs: [],
    },
  };
}

function toAttachmentRef(record: PrismaAttachmentRefRecord): AttachmentRef {
  return {
    id: record.id,
    fileName: record.fileName,
    fileKey: record.fileKey,
    mimeType: record.mimeType as AttachmentMimeType,
    size: record.size,
  };
}

function toTiptapJson(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
