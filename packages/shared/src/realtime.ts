import { z } from "zod";
import { IsoDateTimeSchema, UlidSchema } from "./common.ts";
import { TargetTypeSchema, WorkItemTypeSchema } from "./enums.ts";

export const RealtimeSequenceSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export type RealtimeSequence = z.infer<typeof RealtimeSequenceSchema>;

export const RealtimeSequenceCursorSchema = z
  .string()
  .regex(
    /^(?:[0-9A-HJKMNP-TV-Z]{26}:)?[1-9]\d*$/u,
    "Expected a positive sequence cursor",
  );
export type RealtimeSequenceCursor = z.infer<
  typeof RealtimeSequenceCursorSchema
>;

export const RealtimeEventsQuerySchema = z
  .object({
    lastEventId: RealtimeSequenceCursorSchema.optional(),
  })
  .strict();
export type RealtimeEventsQuery = z.infer<typeof RealtimeEventsQuerySchema>;

export const RealtimeSseEventNameSchema = z.enum([
  "realtime",
  "heartbeat",
  "realtime-resync",
]);
export type RealtimeSseEventName = z.infer<typeof RealtimeSseEventNameSchema>;

export const RealtimeOperationSchema = z.enum([
  "CREATED",
  "UPDATED",
  "DELETED",
  "STATUS_CHANGED",
  "COMMENTED",
  "ATTACHMENT_CHANGED",
  "TAG_CHANGED",
  "ASSIGNEE_CHANGED",
  "VERSION_CHANGED",
]);
export type RealtimeOperation = z.infer<typeof RealtimeOperationSchema>;

export const RealtimeInvalidationKeySchema = z.enum([
  "workbench",
  "space-overview",
  "version-board",
  "work-item-list",
  "bug-list",
  "requirement-list",
  "requirement-detail",
  "intake-list",
  "exception-view",
  "timeline",
  "comments",
  "attachments",
  "document-list",
  "document-detail",
  "document-links",
  "document-comments",
  "document-attachments",
  "document-timeline",
  "resource-documents",
]);
export type RealtimeInvalidationKey = z.infer<
  typeof RealtimeInvalidationKeySchema
>;

export const RealtimeResyncReasonSchema = z.enum([
  "REPLAY_MISS",
  "REPLAY_EXPIRED",
  "SEQUENCE_GAP",
  "SERVER_RESTART",
]);
export type RealtimeResyncReason = z.infer<typeof RealtimeResyncReasonSchema>;

export const RealtimeTargetSchema = z
  .object({
    type: TargetTypeSchema,
    id: UlidSchema,
  })
  .strict();
export type RealtimeTarget = z.infer<typeof RealtimeTargetSchema>;

const RealtimePayloadScalarHintValueSchema = z.union([
  z.string().min(1).max(200),
  z.number().int().safe(),
  z.boolean(),
]);

export const RealtimePayloadHintValueSchema = z.union([
  RealtimePayloadScalarHintValueSchema,
  z.array(RealtimePayloadScalarHintValueSchema).max(20),
]);
export type RealtimePayloadHintValue = z.infer<
  typeof RealtimePayloadHintValueSchema
>;

const sensitiveHintKeys = new Set([
  "title",
  "body",
  "content",
  "contentjson",
  "contenttext",
  "contentmarkdowncache",
  "commentbody",
  "commentcontent",
  "commenttext",
  "commentpreview",
  "attachmentname",
  "attachmentfilename",
  "filename",
  "originalfilename",
  "originalname",
  "description",
  "summary",
  "markdown",
  "text",
  "filekey",
  "previewurl",
  "downloadurl",
  "uploadurl",
]);

function normalizeHintKey(key: string): string {
  return key.replaceAll(/[-_\s]/gu, "").toLowerCase();
}

export const RealtimePayloadHintsSchema = z
  .object({
    targetType: TargetTypeSchema.optional(),
    targetId: UlidSchema.optional(),
    organizationId: UlidSchema.optional(),
    spaceId: UlidSchema.optional(),
    versionId: UlidSchema.optional(),
    requirementId: UlidSchema.optional(),
    intakeItemId: UlidSchema.optional(),
    workItemId: UlidSchema.optional(),
    workItemType: WorkItemTypeSchema.optional(),
    relatedTargetType: TargetTypeSchema.optional(),
    relatedTargetId: UlidSchema.optional(),
    changedFields: z.array(z.string().min(1).max(80)).max(20).optional(),
    suggestFullRefresh: z.boolean().optional(),
    affectsList: z.boolean().optional(),
    affectsDetail: z.boolean().optional(),
  })
  .catchall(RealtimePayloadHintValueSchema)
  .superRefine((hints, ctx) => {
    for (const key of Object.keys(hints)) {
      if (!sensitiveHintKeys.has(normalizeHintKey(key))) {
        continue;
      }

      ctx.addIssue({
        code: "custom",
        message:
          "Realtime hints must not carry business content, comments, attachment names, or object text",
        path: [key],
      });
    }
  });
export type RealtimePayloadHints = z.infer<typeof RealtimePayloadHintsSchema>;

export const RealtimeEventSchema = z
  .object({
    id: UlidSchema,
    sequence: RealtimeSequenceSchema,
    occurredAt: IsoDateTimeSchema,
    actorId: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    target: RealtimeTargetSchema,
    operation: RealtimeOperationSchema,
    invalidates: z.array(RealtimeInvalidationKeySchema).min(1),
    hints: RealtimePayloadHintsSchema.optional(),
  })
  .strict();
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

export const RealtimeResyncScopeSchema = z
  .object({
    organizationId: UlidSchema.optional(),
    spaceId: UlidSchema.optional(),
  })
  .strict();
export type RealtimeResyncScope = z.infer<typeof RealtimeResyncScopeSchema>;

export const RealtimeResyncEventSchema = z
  .object({
    reason: RealtimeResyncReasonSchema,
    occurredAt: IsoDateTimeSchema,
    invalidates: z.array(RealtimeInvalidationKeySchema),
    scope: RealtimeResyncScopeSchema.optional(),
  })
  .strict();
export type RealtimeResyncEvent = z.infer<typeof RealtimeResyncEventSchema>;

export const RealtimeHeartbeatSchema = z
  .object({
    occurredAt: IsoDateTimeSchema,
  })
  .strict();
export type RealtimeHeartbeat = z.infer<typeof RealtimeHeartbeatSchema>;

export const RealtimeSseRealtimeMessageSchema = z
  .object({
    event: z.literal("realtime"),
    id: RealtimeSequenceCursorSchema,
    data: RealtimeEventSchema,
  })
  .strict()
  .superRefine((message, ctx) => {
    const sequenceText = String(message.data.sequence);

    if (
      message.id === sequenceText ||
      message.id.endsWith(`:${sequenceText}`)
    ) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      message: "SSE realtime id must match RealtimeEvent.sequence",
      path: ["id"],
    });
  });
export type RealtimeSseRealtimeMessage = z.infer<
  typeof RealtimeSseRealtimeMessageSchema
>;

export const RealtimeSseHeartbeatMessageSchema = z
  .object({
    event: z.literal("heartbeat"),
    data: RealtimeHeartbeatSchema,
  })
  .strict();
export type RealtimeSseHeartbeatMessage = z.infer<
  typeof RealtimeSseHeartbeatMessageSchema
>;

export const RealtimeSseResyncMessageSchema = z
  .object({
    event: z.literal("realtime-resync"),
    data: RealtimeResyncEventSchema,
  })
  .strict();
export type RealtimeSseResyncMessage = z.infer<
  typeof RealtimeSseResyncMessageSchema
>;

export const RealtimeSseMessageSchema = z.union([
  RealtimeSseRealtimeMessageSchema,
  RealtimeSseHeartbeatMessageSchema,
  RealtimeSseResyncMessageSchema,
]);
export type RealtimeSseMessage = z.infer<typeof RealtimeSseMessageSchema>;
