import { z } from "zod";

const DEFAULT_MINIO_INTERNAL_ENDPOINT = "http://localhost:9000";
const DEFAULT_MINIO_PUBLIC_ENDPOINT = "http://localhost:9000";
const DEFAULT_MINIO_BUCKET = "project-delivery-attachments";
const DEFAULT_MINIO_REGION = "us-east-1";
const DEFAULT_SYSTEM_UPDATE_STATE_DIR = "/tmp/pdm-updater/state";

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

export const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    MINIO_ACCESS_KEY: z.string().min(1).optional(),
    MINIO_AUTO_CREATE_BUCKET: BooleanEnvSchema.optional(),
    MINIO_BUCKET: z.string().min(1).optional(),
    MINIO_FORCE_PATH_STYLE: BooleanEnvSchema.optional(),
    MINIO_INTERNAL_ENDPOINT: z.string().url().optional(),
    MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
    MINIO_REGION: z.string().min(1).optional(),
    MINIO_SECRET_KEY: z.string().min(1).optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),
    SESSION_COOKIE_SECURE: BooleanEnvSchema.optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default("pdm_session"),
    SYSTEM_OPERATOR_USER_IDS: z.string().min(1).optional(),
    SYSTEM_OPERATOR_USERNAMES: z.string().min(1).optional(),
    SYSTEM_UPDATE_STATE_DIR: z.string().min(1).optional(),
    SYSTEM_UPDATE_UPDATER_BASE_URL: z.string().url().optional(),
    SYSTEM_UPDATE_UPDATER_SHARED_SECRET: z.string().min(1).optional(),
    WEB_APP_URL: z.string().url().default("http://localhost:3000"),
  })
  .passthrough()
  .superRefine((env, context) => {
    if (env.NODE_ENV !== "production") {
      return;
    }

    const productionRequiredKeys = [
      "MINIO_ACCESS_KEY",
      "MINIO_AUTO_CREATE_BUCKET",
      "MINIO_BUCKET",
      "MINIO_FORCE_PATH_STYLE",
      "MINIO_INTERNAL_ENDPOINT",
      "MINIO_PUBLIC_ENDPOINT",
      "MINIO_REGION",
      "MINIO_SECRET_KEY",
    ] as const;

    for (const key of productionRequiredKeys) {
      if (env[key] === undefined) {
        context.addIssue({
          code: "custom",
          message: "Required in production",
          path: [key],
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    MINIO_ACCESS_KEY: env.MINIO_ACCESS_KEY ?? "minioadmin",
    MINIO_AUTO_CREATE_BUCKET: env.MINIO_AUTO_CREATE_BUCKET ?? false,
    MINIO_BUCKET: env.MINIO_BUCKET ?? DEFAULT_MINIO_BUCKET,
    MINIO_FORCE_PATH_STYLE: env.MINIO_FORCE_PATH_STYLE ?? true,
    MINIO_INTERNAL_ENDPOINT:
      env.MINIO_INTERNAL_ENDPOINT ?? DEFAULT_MINIO_INTERNAL_ENDPOINT,
    MINIO_PUBLIC_ENDPOINT:
      env.MINIO_PUBLIC_ENDPOINT ?? DEFAULT_MINIO_PUBLIC_ENDPOINT,
    MINIO_REGION: env.MINIO_REGION ?? DEFAULT_MINIO_REGION,
    MINIO_SECRET_KEY: env.MINIO_SECRET_KEY ?? "minioadmin",
    SESSION_COOKIE_SECURE:
      env.SESSION_COOKIE_SECURE ?? (env.NODE_ENV === "production"),
    SYSTEM_UPDATE_STATE_DIR:
      env.SYSTEM_UPDATE_STATE_DIR ?? DEFAULT_SYSTEM_UPDATE_STATE_DIR,
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
