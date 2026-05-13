import { z } from "zod";
import { LocaleSchema, RecordStatusSchema, ThemeModeSchema } from "./enums.ts";

export const UsernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const PasswordSchema = z.string().min(8);

export const UserPreferencesSchema = z
  .object({
    locale: LocaleSchema,
    themeMode: ThemeModeSchema,
  })
  .strict();

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const SessionUserSchema = z
  .object({
    id: z.string().min(1),
    username: UsernameSchema,
    email: z.email().optional(),
    name: z.string().min(1),
    avatar: z.url().optional(),
    status: RecordStatusSchema,
    preferences: UserPreferencesSchema,
  })
  .strict();

export type SessionUser = z.infer<typeof SessionUserSchema>;

export const UpdateUserPreferencesRequestSchema = UserPreferencesSchema;
export type UpdateUserPreferencesRequest = z.infer<
  typeof UpdateUserPreferencesRequestSchema
>;

export const UpdateUserPreferencesResponseSchema = UserPreferencesSchema;
export type UpdateUserPreferencesResponse = z.infer<
  typeof UpdateUserPreferencesResponseSchema
>;
