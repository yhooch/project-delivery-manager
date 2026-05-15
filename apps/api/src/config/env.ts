import { z } from "zod";

export const DEFAULT_ATTACHMENT_OBJECT_STORAGE_ORIGIN =
  "https://object-storage.local";

export const EnvSchema = z
  .object({
    ATTACHMENT_OBJECT_STORAGE_ORIGIN: z.string().url().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),
    SESSION_COOKIE_NAME: z.string().min(1).default("pdm_session"),
    WEB_APP_URL: z.string().url().default("http://localhost:3000"),
  })
  .passthrough()
  .superRefine((env, context) => {
    if (
      env.NODE_ENV === "production" &&
      !env.ATTACHMENT_OBJECT_STORAGE_ORIGIN
    ) {
      context.addIssue({
        code: "custom",
        message: "Required in production",
        path: ["ATTACHMENT_OBJECT_STORAGE_ORIGIN"],
      });
    }
  })
  .transform((env) => ({
    ...env,
    ATTACHMENT_OBJECT_STORAGE_ORIGIN:
      env.ATTACHMENT_OBJECT_STORAGE_ORIGIN ??
      DEFAULT_ATTACHMENT_OBJECT_STORAGE_ORIGIN,
  }));

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);

  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${message}`);
}
