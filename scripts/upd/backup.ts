import path from "node:path";

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|access[_-]?key)/iu;

export type BackupPlanInput = {
  backupRoot?: string;
  releaseId: string;
  composeProject?: string;
  composeFile?: string;
  envFile?: string;
  overrideFile?: string;
  postgresService?: string;
  postgresDatabase?: string;
  postgresUser?: string;
  minioService?: string;
  minioBucket?: string;
  nginxActiveDir?: string;
  apiImage?: string;
  webImage?: string;
  env?: Readonly<Record<string, string | undefined>>;
  allowedBackupRoots?: readonly string[];
};

export type BackupPlanItem = {
  id: string;
  kind: "postgres" | "minio" | "compose" | "env" | "nginx" | "image-refs";
  assetPath: string;
  command: string[];
  logMetadata: Record<string, string>;
};

export type BackupPlan = {
  backupRoot: string;
  items: BackupPlanItem[];
  rollbackAssets: Array<{ id: string; assetPath: string }>;
  redactedEnv: Record<string, string>;
};

export function buildBackupPlan(input: BackupPlanInput): BackupPlan {
  const backupRoot = assertBackupPathAllowed(
    path.join(input.backupRoot ?? "/tmp/pdm-updater/backups", input.releaseId),
    input.allowedBackupRoots ?? ["/tmp"],
  );
  const composeProject = input.composeProject ?? "pdm-prod";
  const composeFile = input.composeFile ?? "docker-compose.prod.yml";
  const envFile = input.envFile ?? ".env.prod";
  const overrideFile = input.overrideFile ?? ".env.prod.release";
  const postgresService = input.postgresService ?? "postgres";
  const postgresDatabase =
    input.postgresDatabase ?? input.env?.POSTGRES_DB ?? "crm_manager";
  const postgresUser = input.postgresUser ?? input.env?.POSTGRES_USER ?? "crm";
  const minioService = input.minioService ?? "minio";
  const minioBucket =
    input.minioBucket ?? input.env?.MINIO_BUCKET ?? "crm-manager-attachments";
  const nginxActiveDir = input.nginxActiveDir ?? "deploy/nginx/active";
  const envSnapshot = path.join(backupRoot, "env.redacted.json");
  const imageRefsSnapshot = path.join(backupRoot, "image-refs.json");
  const items: BackupPlanItem[] = [
    {
      id: "backup-postgres",
      kind: "postgres",
      assetPath: path.join(backupRoot, "postgres.dump"),
      command: [
        "docker",
        "compose",
        "-p",
        composeProject,
        "-f",
        composeFile,
        "exec",
        "-T",
        postgresService,
        "pg_dump",
        "-U",
        postgresUser,
        "-d",
        postgresDatabase,
        "-Fc",
      ],
      logMetadata: {
        database: postgresDatabase,
        user: postgresUser,
        output: path.join(backupRoot, "postgres.dump"),
      },
    },
    {
      id: "backup-minio",
      kind: "minio",
      assetPath: path.join(backupRoot, "minio"),
      command: [
        "docker",
        "compose",
        "-p",
        composeProject,
        "-f",
        composeFile,
        "exec",
        "-T",
        minioService,
        "sh",
        "-lc",
        `tar -C /data -cf - ${shellQuote(minioBucket)}`,
      ],
      logMetadata: {
        bucket: minioBucket,
        output: path.join(backupRoot, "minio"),
      },
    },
    {
      id: "backup-compose",
      kind: "compose",
      assetPath: path.join(backupRoot, path.basename(composeFile)),
      command: [
        "cp",
        composeFile,
        path.join(backupRoot, path.basename(composeFile)),
      ],
      logMetadata: { source: composeFile },
    },
    {
      id: "backup-release-override",
      kind: "compose",
      assetPath: path.join(backupRoot, path.basename(overrideFile)),
      command: [
        "cp",
        overrideFile,
        path.join(backupRoot, path.basename(overrideFile)),
      ],
      logMetadata: { source: overrideFile },
    },
    {
      id: "backup-env-redacted",
      kind: "env",
      assetPath: envSnapshot,
      command: ["write-json", envSnapshot, "<redacted-env>"],
      logMetadata: { source: envFile, output: envSnapshot },
    },
    {
      id: "backup-image-refs",
      kind: "image-refs",
      assetPath: imageRefsSnapshot,
      command: ["write-json", imageRefsSnapshot, "<image-refs>"],
      logMetadata: {
        apiImage: input.apiImage ?? "unknown",
        webImage: input.webImage ?? "unknown",
      },
    },
    {
      id: "backup-nginx-active",
      kind: "nginx",
      assetPath: path.join(backupRoot, "nginx-active"),
      command: [
        "cp",
        "-a",
        nginxActiveDir,
        path.join(backupRoot, "nginx-active"),
      ],
      logMetadata: { source: nginxActiveDir },
    },
  ];

  return {
    backupRoot,
    items,
    rollbackAssets: items.map((item) => ({
      id: item.id,
      assetPath: item.assetPath,
    })),
    redactedEnv: redactEnv(input.env ?? {}),
  };
}

export function redactEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      !value ? "" : SECRET_KEY_PATTERN.test(key) ? redactSecret(value) : value,
    ]),
  );
}

export function assertBackupPathAllowed(
  targetPath: string,
  allowedRoots: readonly string[],
): string {
  const resolvedTarget = path.resolve(targetPath);
  const allowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);

    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });

  if (!allowed) {
    throw new Error(`backup path is outside allowed roots: ${targetPath}`);
  }

  return resolvedTarget;
}

function redactSecret(value: string): string {
  if (value.length <= 8) {
    return "***";
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
