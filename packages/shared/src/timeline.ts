import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import {
  CommentTargetTypeSchema,
  ObjectParticipantRelationSchema,
  ObjectParticipantTargetTypeSchema,
  TargetTypeSchema,
  TimelineEventTypeSchema,
  WorkItemTypeSchema,
} from "./enums.ts";
import { DisplayIdentitySchema } from "./object-code.ts";

export const ObjectParticipantSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    targetType: ObjectParticipantTargetTypeSchema,
    targetId: UlidSchema,
    userId: UlidSchema,
    relationType: ObjectParticipantRelationSchema,
    createdAt: IsoDateTimeSchema,
    deletedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type ObjectParticipant = z.infer<typeof ObjectParticipantSchema>;

export const TimelineActorSchema = z
  .object({
    id: UlidSchema,
    username: z.string().min(1),
    name: z.string().min(1),
    avatar: z.url().optional(),
  })
  .strict();

export type TimelineActor = z.infer<typeof TimelineActorSchema>;

export const TimelineTargetSchema = z
  .object({
    type: TargetTypeSchema,
    id: UlidSchema,
    sequence: DisplayIdentitySchema.shape.sequence,
    displayCode: DisplayIdentitySchema.shape.displayCode,
    title: z.string().min(1).optional(),
  })
  .strict();

export type TimelineTarget = z.infer<typeof TimelineTargetSchema>;

export const TimelineEventMetadataSchema = z
  .object({
    actionCode: z.string().min(1).optional(),
    actionId: UlidSchema.optional(),
    actionName: z.string().min(1).optional(),
    attachmentId: UlidSchema.optional(),
    changedFields: z.array(z.string().min(1)).optional(),
    commentId: UlidSchema.optional(),
    commentPreview: z.string().min(1).optional(),
    fileKey: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    formValues: z.record(z.string(), z.string().or(z.number())).optional(),
    fromStateCode: z.string().min(1).optional(),
    fromStateId: UlidSchema.optional(),
    fromStateName: z.string().min(1).optional(),
    lifecycleEvent: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    operation: z.string().min(1).optional(),
    size: z.number().int().nonnegative().optional(),
    sourceTargetId: UlidSchema.optional(),
    sourceTargetType: z.string().min(1).optional(),
    targetWorkItemType: WorkItemTypeSchema.optional(),
    toStateCode: z.string().min(1).optional(),
    toStateId: UlidSchema.optional(),
    toStateName: z.string().min(1).optional(),
    workItemIds: z.array(UlidSchema).optional(),
    workItemType: WorkItemTypeSchema.optional(),
  })
  .catchall(z.unknown());

export type TimelineEventMetadata = z.infer<
  typeof TimelineEventMetadataSchema
>;

export const TimelineEventSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    target: TimelineTargetSchema,
    eventType: TimelineEventTypeSchema,
    actor: TimelineActorSchema,
    title: z.string().min(1),
    detail: z.string().optional(),
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    metadata: TimelineEventMetadataSchema.optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const TimelineQuerySchema = PageQuerySchema.extend({
  targetType: TargetTypeSchema,
  targetId: UlidSchema,
});

export const WorkItemTimelineQuerySchema = PageQuerySchema;
export const TimelineResponseSchema = pageResultSchema(TimelineEventSchema);

export const CommentSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    targetType: CommentTargetTypeSchema,
    targetId: UlidSchema,
    author: TimelineActorSchema,
    body: z.string().min(1).max(8000),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type Comment = z.infer<typeof CommentSchema>;

export const CommentQuerySchema = PageQuerySchema.extend({
  targetType: CommentTargetTypeSchema,
  targetId: UlidSchema,
});

export const CreateCommentRequestSchema = z
  .object({
    targetType: CommentTargetTypeSchema,
    targetId: UlidSchema,
    body: z.string().min(1).max(8000),
  })
  .strict();

export const ListCommentsResponseSchema = pageResultSchema(CommentSchema);
export const CreateCommentResponseSchema = CommentSchema;
