import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";
import { AttachmentTargetTypeSchema } from "./enums.ts";

export const AttachmentMaxSizeBytes = 20 * 1024 * 1024;
export const AttachmentMaxCountPerTarget = 20;

export const AttachmentMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

export type AttachmentMimeType = z.infer<typeof AttachmentMimeTypeSchema>;

const AttachmentSizeSchema = z
  .number()
  .int()
  .positive()
  .max(AttachmentMaxSizeBytes);
const AttachmentStoredMetadataSchema = z.object({
  mimeType: AttachmentMimeTypeSchema,
  size: AttachmentSizeSchema,
});

export const AttachmentSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    targetType: AttachmentTargetTypeSchema,
    targetId: UlidSchema,
    fileName: z.string().min(1),
    fileKey: z.string().min(1),
    ...AttachmentStoredMetadataSchema.shape,
    uploadedById: UlidSchema,
    previewUrl: z.url().optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type Attachment = z.infer<typeof AttachmentSchema>;

export const UploadAttachmentRequestSchema = z
  .object({
    targetType: AttachmentTargetTypeSchema,
    targetId: UlidSchema,
  })
  .strict();

export type UploadAttachmentRequest = z.infer<
  typeof UploadAttachmentRequestSchema
>;

export const AttachmentListQuerySchema = PageQuerySchema.extend({
  targetType: AttachmentTargetTypeSchema,
  targetId: UlidSchema,
});

export const ListAttachmentsResponseSchema = pageResultSchema(AttachmentSchema);
export const CreateAttachmentResponseSchema = AttachmentSchema;
