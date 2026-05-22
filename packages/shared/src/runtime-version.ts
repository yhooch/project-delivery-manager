import { z } from "zod";

export const RuntimeServiceSchema = z.enum(["api", "web"]);

export type RuntimeService = z.infer<typeof RuntimeServiceSchema>;

export type RuntimeVersionProof<
  Service extends RuntimeService = RuntimeService,
> = {
  service: Service;
  status: "ok";
  version: string;
  commit: string;
  buildTime: string;
  imageDigest: string;
  channel: string;
};

export const RuntimeVersionProofSchema = z
  .object({
    service: RuntimeServiceSchema,
    status: z.literal("ok"),
    version: z.string().min(1),
    commit: z.string().min(1),
    buildTime: z.string().min(1),
    imageDigest: z.string().min(1),
    channel: z.string().min(1),
  })
  .strict();

export type RuntimeVersionEnv = Readonly<Record<string, string | undefined>>;

type RuntimeVersionField =
  | "version"
  | "commit"
  | "buildTime"
  | "imageDigest"
  | "channel";

type RuntimeVersionEnvKeyMap = Record<RuntimeVersionField, readonly string[]>;

const UNKNOWN_RUNTIME_VERSION_VALUE = "unknown";
const DEFAULT_RUNTIME_CHANNEL = "development";

const COMMON_ENV_KEYS: RuntimeVersionEnvKeyMap = {
  version: [
    "APP_VERSION",
    "RELEASE_VERSION",
    "VERSION",
    "NEXT_PUBLIC_APP_VERSION",
  ],
  commit: [
    "GIT_COMMIT",
    "COMMIT_SHA",
    "SOURCE_COMMIT",
    "VCS_REF",
    "BUILD_COMMIT",
    "NEXT_PUBLIC_GIT_COMMIT",
    "NEXT_PUBLIC_COMMIT_SHA",
  ],
  buildTime: [
    "BUILD_TIME",
    "BUILD_DATE",
    "IMAGE_CREATED",
    "NEXT_PUBLIC_BUILD_TIME",
  ],
  imageDigest: [
    "IMAGE_DIGEST",
    "CONTAINER_IMAGE_DIGEST",
    "OCI_IMAGE_DIGEST",
    "NEXT_PUBLIC_IMAGE_DIGEST",
  ],
  channel: [
    "RELEASE_CHANNEL",
    "DEPLOY_CHANNEL",
    "APP_CHANNEL",
    "CHANNEL",
    "NEXT_PUBLIC_RELEASE_CHANNEL",
  ],
};

export function buildRuntimeVersionProof<Service extends RuntimeService>(
  service: Service,
  env: RuntimeVersionEnv,
): RuntimeVersionProof<Service> {
  const envKeys = buildEnvKeys(service);

  return {
    service,
    status: "ok",
    version: readEnvValue(
      env,
      envKeys.version,
      UNKNOWN_RUNTIME_VERSION_VALUE,
    ),
    commit: readEnvValue(env, envKeys.commit, UNKNOWN_RUNTIME_VERSION_VALUE),
    buildTime: readEnvValue(
      env,
      envKeys.buildTime,
      UNKNOWN_RUNTIME_VERSION_VALUE,
    ),
    imageDigest: readEnvValue(
      env,
      envKeys.imageDigest,
      UNKNOWN_RUNTIME_VERSION_VALUE,
    ),
    channel: readEnvValue(env, envKeys.channel, DEFAULT_RUNTIME_CHANNEL),
  };
}

function buildEnvKeys(service: RuntimeService): RuntimeVersionEnvKeyMap {
  const prefix = service.toUpperCase();

  return {
    version: [
      `${prefix}_VERSION`,
      `${prefix}_APP_VERSION`,
      ...COMMON_ENV_KEYS.version,
    ],
    commit: [
      `${prefix}_COMMIT`,
      `${prefix}_COMMIT_SHA`,
      `${prefix}_GIT_COMMIT`,
      ...COMMON_ENV_KEYS.commit,
    ],
    buildTime: [
      `${prefix}_BUILD_TIME`,
      `${prefix}_BUILD_DATE`,
      ...COMMON_ENV_KEYS.buildTime,
    ],
    imageDigest: [
      `${prefix}_IMAGE_DIGEST`,
      `${prefix}_CONTAINER_IMAGE_DIGEST`,
      ...COMMON_ENV_KEYS.imageDigest,
    ],
    channel: [
      `${prefix}_CHANNEL`,
      `${prefix}_RELEASE_CHANNEL`,
      `${prefix}_DEPLOY_CHANNEL`,
      ...COMMON_ENV_KEYS.channel,
    ],
  };
}

function readEnvValue(
  env: RuntimeVersionEnv,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return fallback;
}
