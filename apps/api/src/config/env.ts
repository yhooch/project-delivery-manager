import { z } from "zod";

const DEFAULT_MINIO_INTERNAL_ENDPOINT = "http://localhost:9000";
const DEFAULT_MINIO_PUBLIC_ENDPOINT = "http://localhost:9000";
const DEFAULT_MINIO_BUCKET = "project-delivery-attachments";
const DEFAULT_MINIO_REGION = "us-east-1";

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

const QueryLogModeEnvSchema = z.preprocess((value) => {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}, z.enum(["all", "off", "slow"]));

export const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    HTTP_ACCESS_LOG_ENABLED: BooleanEnvSchema.optional(),
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
    QUERY_LOG_INCLUDE_PARAMS: BooleanEnvSchema.optional(),
    QUERY_LOG_MODE: QueryLogModeEnvSchema.optional(),
    QUERY_LOG_SQL_MAX_LENGTH: z.coerce.number().int().positive().optional(),
    SESSION_COOKIE_SECURE: BooleanEnvSchema.optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default("pdm_session"),
    SLOW_HTTP_LOG_ENABLED: BooleanEnvSchema.optional(),
    SLOW_HTTP_MS: z.coerce.number().int().nonnegative().optional(),
    SLOW_QUERY_LOG_ENABLED: BooleanEnvSchema.optional(),
    SLOW_QUERY_MS: z.coerce.number().int().nonnegative().optional(),
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
    HTTP_ACCESS_LOG_ENABLED: env.HTTP_ACCESS_LOG_ENABLED ?? true,
    QUERY_LOG_INCLUDE_PARAMS: env.QUERY_LOG_INCLUDE_PARAMS ?? true,
    QUERY_LOG_MODE: env.QUERY_LOG_MODE ?? "slow",
    QUERY_LOG_SQL_MAX_LENGTH: env.QUERY_LOG_SQL_MAX_LENGTH ?? 2_000,
    SESSION_COOKIE_SECURE:
      env.SESSION_COOKIE_SECURE ?? (env.NODE_ENV === "production"),
    SLOW_HTTP_LOG_ENABLED: env.SLOW_HTTP_LOG_ENABLED ?? true,
    SLOW_HTTP_MS: env.SLOW_HTTP_MS ?? 1_000,
    SLOW_QUERY_LOG_ENABLED: env.SLOW_QUERY_LOG_ENABLED ?? true,
    SLOW_QUERY_MS: env.SLOW_QUERY_MS ?? 300,
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
