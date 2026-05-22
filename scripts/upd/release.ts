import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type UpdateErrorCode,
  type UpdateManifest,
  UpdateManifestSchema,
  type UpdateMigrationRef,
  type UpdateNginxReleaseBlock,
} from "../../packages/shared/src/update.ts";

export const DEFAULT_MANIFEST_FILE = "manifest.json";
export const DEFAULT_SIGNATURE_FILE = "manifest.json.sig";

const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env\.prod$/iu,
  /(^|\/)\.env(\.|$)/iu,
  /(^|\/)id_rsa$/iu,
  /(^|\/).*private[-_]?key/iu,
];

const SECRET_CONTENT_PATTERNS = [
  /\b(token|password|secret|access[_ -]?key)\b\s*[:=]\s*["']?[^"'\s]{8,}/iu,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/u,
];

export class UpdatePackageValidationError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "UpdatePackageValidationError";
  }
}

export type BuildReleaseManifestInput = Omit<
  UpdateManifest,
  "checksums" | "dbSchemaMigrations" | "systemDataMigrations" | "nginx"
> & {
  dbSchemaMigrations?: Array<Omit<UpdateMigrationRef, "sha256">>;
  systemDataMigrations?: Array<Omit<UpdateMigrationRef, "sha256">>;
  nginx: Omit<UpdateNginxReleaseBlock, "sha256">;
};

export type ValidateReleasePackageOptions = {
  releaseDir: string;
  manifestPath?: string;
  signaturePath?: string;
  publicKeyPem?: string;
};

export type ValidateReleasePackageResult = {
  manifest: UpdateManifest;
  checkedFiles: number;
};

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

export async function buildChecksums(
  releaseDir: string,
): Promise<Record<string, string>> {
  const files = await listPackageFiles(releaseDir);
  const checksums: Record<string, string> = {};

  for (const file of files) {
    if (isManifestSidecar(file)) {
      continue;
    }

    checksums[file] = await sha256File(path.join(releaseDir, file));
  }

  return checksums;
}

export async function buildReleaseManifestFromDirectory(
  releaseDir: string,
  input: BuildReleaseManifestInput,
): Promise<UpdateManifest> {
  const checksums = await buildChecksums(releaseDir);
  const nginxChecksum = checksums[input.nginx.templatePath];

  if (!nginxChecksum) {
    throw new UpdatePackageValidationError(
      "UPDATE_CHECKSUM_MISMATCH",
      `nginx template is missing from release package: ${input.nginx.templatePath}`,
    );
  }

  const dbSchemaMigrations = attachMigrationChecksums(
    input.dbSchemaMigrations ?? [],
    checksums,
  );
  const systemDataMigrations = attachMigrationChecksums(
    input.systemDataMigrations ?? [],
    checksums,
  );

  return UpdateManifestSchema.parse({
    ...input,
    dbSchemaMigrations,
    systemDataMigrations,
    nginx: {
      ...input.nginx,
      sha256: nginxChecksum,
    },
    checksums,
  });
}

export async function writeManifest(
  manifestPath: string,
  manifest: UpdateManifest,
): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function signManifestFile(
  manifestPath: string,
  privateKeyPem: string,
): Promise<Buffer> {
  const key = createPrivateKey(privateKeyPem);

  return signBytes(null, await readFile(manifestPath), key);
}

export async function writeManifestSignature(
  manifestPath: string,
  signaturePath: string,
  privateKeyPem: string,
): Promise<void> {
  await writeFile(
    signaturePath,
    (await signManifestFile(manifestPath, privateKeyPem)).toString("base64"),
  );
}

export async function verifyManifestSignature(
  manifestPath: string,
  signaturePath: string,
  publicKeyPem: string,
): Promise<boolean> {
  const key = createPublicKey(publicKeyPem);
  const signature = Buffer.from(
    (await readFile(signaturePath, "utf8")).trim(),
    "base64",
  );

  return verifyBytes(null, await readFile(manifestPath), key, signature);
}

export async function validateReleasePackage(
  options: ValidateReleasePackageOptions,
): Promise<ValidateReleasePackageResult> {
  const manifestPath =
    options.manifestPath ??
    path.join(options.releaseDir, DEFAULT_MANIFEST_FILE);
  const signaturePath =
    options.signaturePath ??
    path.join(options.releaseDir, DEFAULT_SIGNATURE_FILE);
  const secretLeaks = await detectSecretLeaks(options.releaseDir);

  if (secretLeaks.length > 0) {
    throw new UpdatePackageValidationError(
      "UPDATE_PACKAGE_SECRET_DETECTED",
      "release package contains possible secrets",
      secretLeaks,
    );
  }

  const manifest = await readManifest(manifestPath);

  assertImageDigest(
    "api",
    manifest.images.api.image,
    manifest.images.api.digest,
  );
  assertImageDigest(
    "web",
    manifest.images.web.image,
    manifest.images.web.digest,
  );
  await assertChecksums(options.releaseDir, manifest);

  if (options.publicKeyPem) {
    try {
      if (
        !(await verifyManifestSignature(
          manifestPath,
          signaturePath,
          options.publicKeyPem,
        ))
      ) {
        throw new UpdatePackageValidationError(
          "UPDATE_SIGNATURE_INVALID",
          "manifest detached signature is invalid",
        );
      }
    } catch (error) {
      if (error instanceof UpdatePackageValidationError) {
        throw error;
      }

      throw new UpdatePackageValidationError(
        "UPDATE_SIGNATURE_INVALID",
        "manifest detached signature could not be verified",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    manifest,
    checkedFiles: Object.keys(manifest.checksums).length,
  };
}

export async function detectSecretLeaks(
  releaseDir: string,
): Promise<Array<{ path: string; reason: string }>> {
  const leaks: Array<{ path: string; reason: string }> = [];

  for (const file of await listPackageFiles(releaseDir)) {
    const normalized = normalizePackagePath(file);
    const pathMatch = SECRET_PATH_PATTERNS.find((pattern) =>
      pattern.test(normalized),
    );

    if (pathMatch) {
      leaks.push({ path: normalized, reason: "secret-like file path" });
      continue;
    }

    const absolutePath = path.join(releaseDir, normalized);
    const fileStat = await stat(absolutePath);

    if (fileStat.size > 2 * 1024 * 1024) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8").catch(() => "");
    const contentMatch = SECRET_CONTENT_PATTERNS.find((pattern) =>
      pattern.test(content),
    );

    if (contentMatch) {
      leaks.push({ path: normalized, reason: "secret-like assignment" });
    }
  }

  return leaks;
}

async function readManifest(manifestPath: string): Promise<UpdateManifest> {
  try {
    return UpdateManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
  } catch (error) {
    throw new UpdatePackageValidationError(
      "UPDATE_MANIFEST_INVALID",
      "manifest JSON does not match UPD schema",
      error instanceof Error ? error.message : error,
    );
  }
}

async function assertChecksums(
  releaseDir: string,
  manifest: UpdateManifest,
): Promise<void> {
  const nginxChecksum = manifest.checksums[manifest.nginx.templatePath];

  if (!nginxChecksum || nginxChecksum !== manifest.nginx.sha256) {
    throw new UpdatePackageValidationError(
      "UPDATE_CHECKSUM_MISMATCH",
      "nginx template checksum must match manifest nginx block",
      {
        templatePath: manifest.nginx.templatePath,
        expected: manifest.nginx.sha256,
        actual: nginxChecksum,
      },
    );
  }

  for (const migration of [
    ...manifest.dbSchemaMigrations,
    ...manifest.systemDataMigrations,
  ]) {
    if (manifest.checksums[migration.path] !== migration.sha256) {
      throw new UpdatePackageValidationError(
        "UPDATE_CHECKSUM_MISMATCH",
        `migration checksum must match checksums map: ${migration.path}`,
      );
    }
  }

  for (const [packagePath, expected] of Object.entries(manifest.checksums)) {
    const absolutePath = path.join(releaseDir, packagePath);
    const actual = await sha256File(absolutePath).catch((error: unknown) => {
      throw new UpdatePackageValidationError(
        "UPDATE_CHECKSUM_MISMATCH",
        `checksummed asset is missing or unreadable: ${packagePath}`,
        error instanceof Error ? error.message : error,
      );
    });

    if (actual !== expected) {
      throw new UpdatePackageValidationError(
        "UPDATE_CHECKSUM_MISMATCH",
        `checksum mismatch for ${packagePath}`,
        { expected, actual },
      );
    }
  }
}

function assertImageDigest(
  service: "api" | "web",
  image: string,
  digest: string,
): void {
  const digestInImage = image.match(/@(?<digest>sha256:[a-f0-9]{64})$/u)?.groups
    ?.digest;

  if (digestInImage && digestInImage !== digest) {
    throw new UpdatePackageValidationError(
      "UPDATE_DIGEST_MISMATCH",
      `${service} image digest does not match digest field`,
      { image, digest },
    );
  }
}

function attachMigrationChecksums(
  migrations: Array<Omit<UpdateMigrationRef, "sha256">>,
  checksums: Record<string, string>,
): UpdateMigrationRef[] {
  return migrations.map((migration) => {
    const sha256 = checksums[migration.path];

    if (!sha256) {
      throw new UpdatePackageValidationError(
        "UPDATE_CHECKSUM_MISMATCH",
        `migration is missing from release package: ${migration.path}`,
      );
    }

    return {
      ...migration,
      sha256,
    };
  });
}

async function listPackageFiles(releaseDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(
          normalizePackagePath(path.relative(releaseDir, absolutePath)),
        );
      }
    }
  }

  await walk(releaseDir);

  return files.sort();
}

function isManifestSidecar(packagePath: string): boolean {
  return (
    packagePath === DEFAULT_MANIFEST_FILE ||
    packagePath === DEFAULT_SIGNATURE_FILE
  );
}

function normalizePackagePath(packagePath: string): string {
  return packagePath.split(path.sep).join("/");
}
