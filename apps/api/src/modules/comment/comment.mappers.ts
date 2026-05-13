import type {
  Comment,
  CommentTargetType,
  TimelineActor,
} from "@project-delivery/shared";

type CommentAuthorRecord = {
  avatar: string | null;
  id: string;
  name: string;
  username: string;
};

type PrismaCommentRecord = {
  author: CommentAuthorRecord;
  body: string;
  createdAt: Date;
  id: string;
  organizationId: string;
  spaceId: string;
  targetId: string;
  targetType: CommentTargetType;
  updatedAt: Date;
};

export function toComment(record: PrismaCommentRecord): Comment {
  return {
    id: record.id,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    targetType: record.targetType,
    targetId: record.targetId,
    author: toTimelineActor(record.author),
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toTimelineActor(record: CommentAuthorRecord): TimelineActor {
  return {
    id: record.id,
    username: record.username,
    name: record.name,
    avatar: record.avatar ?? undefined,
  };
}
