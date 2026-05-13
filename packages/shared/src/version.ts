import { z } from "zod";
import {
  IsoDateTimeSchema,
  PageQuerySchema,
  UlidSchema,
  pageResultSchema,
} from "./common.ts";

export const VersionStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "RELEASED",
  "ARCHIVED",
]);

export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const VersionStatsSchema = z
  .object({
    requirementCount: z.number().int().min(0),
    taskCount: z.number().int().min(0),
    bugCount: z.number().int().min(0),
    blockedCount: z.number().int().min(0),
  })
  .strict();

export type VersionStats = z.infer<typeof VersionStatsSchema>;

export const VersionSchema = z
  .object({
    id: UlidSchema,
    organizationId: UlidSchema,
    spaceId: UlidSchema,
    name: z.string().min(1).max(120),
    target: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    ownerId: UlidSchema.optional(),
    status: VersionStatusSchema,
    startDate: IsoDateTimeSchema.optional(),
    targetDate: IsoDateTimeSchema.optional(),
    releaseDate: IsoDateTimeSchema.optional(),
    stats: VersionStatsSchema,
  })
  .strict();

export type Version = z.infer<typeof VersionSchema>;

export const VersionSummarySchema = VersionSchema.pick({
  id: true,
  organizationId: true,
  spaceId: true,
  name: true,
  target: true,
  ownerId: true,
  status: true,
  startDate: true,
  targetDate: true,
  releaseDate: true,
  stats: true,
});

export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const CreateVersionRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    target: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    ownerId: UlidSchema.optional(),
    status: VersionStatusSchema.optional(),
    startDate: IsoDateTimeSchema.optional(),
    targetDate: IsoDateTimeSchema.optional(),
    releaseDate: IsoDateTimeSchema.optional(),
  })
  .strict();

export type CreateVersionRequest = z.infer<typeof CreateVersionRequestSchema>;

export const UpdateVersionRequestSchema = CreateVersionRequestSchema.partial()
  .strict();

export type UpdateVersionRequest = z.infer<typeof UpdateVersionRequestSchema>;

export const ListVersionsQuerySchema = PageQuerySchema.extend({
  ownerId: UlidSchema.optional(),
  status: VersionStatusSchema.optional(),
});
export const ListVersionsResponseSchema = pageResultSchema(VersionSchema);
export const CreateVersionResponseSchema = VersionSchema;
export const GetVersionResponseSchema = VersionSchema;
export const UpdateVersionResponseSchema = VersionSchema;
