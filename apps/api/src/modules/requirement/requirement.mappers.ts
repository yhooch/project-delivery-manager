import type {
  AttachmentMimeType,
  AttachmentRef,
  Requirement,
  RequirementRelatedWorkItemSummary,
  RequirementRelatedWorkItems,
  RequirementStatus,
  StatusCategory,
  WorkItemType,
} from "@project-delivery/shared";

type PrismaRequirementRecord = {
  authorId: string | null;
  contentFormat: "TIPTAP_JSON";
  contentJson: unknown;
  contentMarkdownCache: string | null;
  contentText: string | null;
  createdAt: Date;
  id: string;
  organizationId: string;
  ownerId: string | null;
  priority: Requirement["priority"] | null;
  spaceId: string;
  status: RequirementStatus;
  summary: string | null;
  title: string;
  updatedAt: Date;
  versionId: string | null;
};

type PrismaAttachmentRefRecord = {
  fileKey: string;
  fileName: string;
  id: string;
  mimeType: string;
  size: number;
};

type PrismaRelatedWorkItemRecord = {
  assigneeId: string | null;
  id: string;
  statusCategory: StatusCategory;
  title: string;
  type: WorkItemType;
  versionId: string | null;
};

export function toRequirement(
  record: PrismaRequirementRecord,
  attachments: PrismaAttachmentRefRecord[] = [],
  relatedWorkItems: RequirementRelatedWorkItems = emptyRelatedWorkItems(),
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
    authorId: record.authorId ?? undefined,
    attachments: attachments.map(toAttachmentRef),
    relatedWorkItems,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toRequirementRelatedWorkItems(
  records: PrismaRelatedWorkItemRecord[],
): RequirementRelatedWorkItems {
  const tasks: RequirementRelatedWorkItemSummary[] = [];
  const bugs: RequirementRelatedWorkItemSummary[] = [];

  for (const record of records) {
    const item = toRelatedWorkItemSummary(record);

    if (item.type === "TASK") {
      tasks.push(item);
    } else {
      bugs.push(item);
    }
  }

  return {
    taskCount: tasks.length,
    bugCount: bugs.length,
    tasks,
    bugs,
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

function toRelatedWorkItemSummary(
  record: PrismaRelatedWorkItemRecord,
): RequirementRelatedWorkItemSummary {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    versionId: record.versionId ?? undefined,
    assigneeId: record.assigneeId ?? undefined,
    statusCategory: record.statusCategory,
  };
}

function emptyRelatedWorkItems(): RequirementRelatedWorkItems {
  return {
    taskCount: 0,
    bugCount: 0,
    tasks: [],
    bugs: [],
  };
}

function toTiptapJson(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
