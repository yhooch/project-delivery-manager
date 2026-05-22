import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildGithubHeaders,
  buildGithubReleaseProviderConfig,
  fetchLatestGithubRelease,
  GithubReleaseProviderError,
  latestReleaseUrl,
  redactGithubConfig,
} from "./github-provider.ts";
import {
  buildReleaseManifestFromDirectory,
  DEFAULT_MANIFEST_FILE,
  DEFAULT_SIGNATURE_FILE,
  validateReleasePackage,
  writeManifest,
  writeManifestSignature,
  type BuildReleaseManifestInput,
} from "./release.ts";
import { UpdaterStateStore } from "./state.ts";
import { buildBackupPlan, redactEnv, type BackupPlan } from "./backup.ts";
import {
  assertPathAllowed,
  buildNginxDeploymentPlan,
  renderNginxTemplate,
} from "./nginx.ts";
import {
  planSystemDataMigrations,
  runSystemDataMigrations,
  sha256Text,
  type SystemDataMigrationExecutor,
  type SystemDataMigrationRecord,
} from "./system-data.ts";

const apiDigest = `sha256:${"a".repeat(64)}`;
const webDigest = `sha256:${"b".repeat(64)}`;

describe("UPD release package validation", () => {
  it("builds checksums and verifies an Ed25519 detached signature", async () => {
    const releaseDir = await createReleaseDir();
    const manifest = await buildReleaseManifestFromDirectory(
      releaseDir,
      buildManifestInput(),
    );
    const manifestPath = path.join(releaseDir, DEFAULT_MANIFEST_FILE);
    const signaturePath = path.join(releaseDir, DEFAULT_SIGNATURE_FILE);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({
      format: "pem",
      type: "pkcs8",
    }) as string;
    const publicKeyPem = publicKey.export({
      format: "pem",
      type: "spki",
    }) as string;

    await writeManifest(manifestPath, manifest);
    await writeManifestSignature(manifestPath, signaturePath, privateKeyPem);

    await expect(
      validateReleasePackage({
        releaseDir,
        publicKeyPem,
      }),
    ).resolves.toMatchObject({
      checkedFiles: 3,
      manifest: {
        version: "1.2.3",
      },
    });
  });

  it("rejects asset checksum mismatches", async () => {
    const releaseDir = await createSignedReleaseDir();
    await writeFile(path.join(releaseDir, "release-notes.md"), "tampered\n");

    await expect(validateReleasePackage({ releaseDir })).rejects.toMatchObject({
      code: "UPDATE_CHECKSUM_MISMATCH",
    });
  });

  it("rejects invalid manifest signatures", async () => {
    const releaseDir = await createSignedReleaseDir();
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({
      format: "pem",
      type: "spki",
    }) as string;

    await expect(
      validateReleasePackage({ releaseDir, publicKeyPem }),
    ).rejects.toMatchObject({
      code: "UPDATE_SIGNATURE_INVALID",
    });
  });

  it("rejects secret-like files in the package", async () => {
    const releaseDir = await createReleaseDir();
    const manifest = await buildReleaseManifestFromDirectory(
      releaseDir,
      buildManifestInput(),
    );

    await writeManifest(path.join(releaseDir, DEFAULT_MANIFEST_FILE), manifest);
    await writeFile(path.join(releaseDir, ".env.prod"), "TOKEN=super-secret\n");

    await expect(validateReleasePackage({ releaseDir })).rejects.toMatchObject({
      code: "UPDATE_PACKAGE_SECRET_DETECTED",
    });
  });
});

describe("UPD updater state store", () => {
  it("persists status, dry-run jobs, and step logs across store instances", async () => {
    const releaseDir = await createReleaseDir();
    const manifest = await buildReleaseManifestFromDirectory(
      releaseDir,
      buildManifestInput(),
    );
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "upd-state-"));
    const firstStore = new UpdaterStateStore({ stateDir });
    const job = await firstStore.createDryRunJob(manifest);

    await firstStore.appendStepLog(job.id, "validate", {
      level: "info",
      message: "manifest validated",
    });

    const secondStore = new UpdaterStateStore({ stateDir });
    const persistedStatus = await secondStore.readStatus();
    const persistedJob = await secondStore.readJob(job.id);

    expect(persistedStatus.activeJobId).toBe(job.id);
    expect(persistedJob.steps[0]?.logs[0]?.message).toBe("manifest validated");
    expect(
      JSON.parse(await readFile(secondStore.jobPath(job.id), "utf8")).id,
    ).toBe(job.id);
  });
});

describe("UPD GitHub release provider", () => {
  it("builds URLs and redacts token-bearing config", () => {
    const config = buildGithubReleaseProviderConfig({
      UPD_GITHUB_REPOSITORY: "acme/pdm",
      UPD_GITHUB_TOKEN: "ghp_1234567890abcdef",
      UPD_RELEASE_CHANNEL: "stable",
    });

    expect(latestReleaseUrl(config)).toBe(
      "https://api.github.com/repos/acme/pdm/releases/latest",
    );
    expect(buildGithubHeaders(config)).toMatchObject({
      Authorization: "Bearer ghp_1234567890abcdef",
    });
    expect(redactGithubConfig(config).token).toBe("ghp_...cdef");
  });

  it("maps GitHub access failures to update errors", async () => {
    const config = buildGithubReleaseProviderConfig({
      UPD_GITHUB_REPOSITORY: "acme/pdm",
    });
    const fetchImpl = async () =>
      new Response("forbidden", {
        status: 403,
      });

    await expect(
      fetchLatestGithubRelease(config, fetchImpl),
    ).rejects.toBeInstanceOf(GithubReleaseProviderError);
    await expect(
      fetchLatestGithubRelease(config, fetchImpl),
    ).rejects.toMatchObject({
      code: "UPDATE_ACCESS_DENIED",
      status: 403,
    });
  });
});

describe("UPD system data migrations", () => {
  it("applies once and skips the same checksum on repeated runs", async () => {
    const executor = new FakeSystemDataMigrationExecutor();
    let executions = 0;
    const migration = {
      id: "2026-05-22.seed-system-settings",
      checksum: sha256Text("seed-system-settings"),
      execute: () => {
        executions += 1;
      },
    };

    await expect(
      runSystemDataMigrations([migration], executor),
    ).resolves.toMatchObject({
      applied: [migration.id],
      skipped: [],
    });
    await expect(
      runSystemDataMigrations([migration], executor),
    ).resolves.toMatchObject({
      applied: [],
      skipped: [migration.id],
    });

    expect(executions).toBe(1);
  });

  it("blocks checksum drift for an already recorded migration id", async () => {
    const executor = new FakeSystemDataMigrationExecutor();
    const migration = {
      id: "2026-05-22.seed-system-settings",
      checksum: sha256Text("v1"),
      execute: () => undefined,
    };

    await runSystemDataMigrations([migration], executor);

    await expect(
      runSystemDataMigrations(
        [
          {
            ...migration,
            checksum: sha256Text("v2"),
          },
        ],
        executor,
      ),
    ).rejects.toMatchObject({
      code: "SYSTEM_DATA_MIGRATION_CHECKSUM_DRIFT",
    });
  });

  it("plans retry for failed same-checksum records and block for drift", () => {
    const checksum = sha256Text("migration");
    const drifted = sha256Text("drifted");

    expect(
      planSystemDataMigrations(
        [
          { id: "one", checksum },
          { id: "two", checksum },
        ],
        [
          {
            id: "record-one",
            migrationId: "one",
            checksum,
            status: "FAILED",
          },
          {
            id: "record-two",
            migrationId: "two",
            checksum: drifted,
            status: "APPLIED",
          },
        ],
      ),
    ).toMatchObject([
      { migrationId: "one", action: "retry" },
      { migrationId: "two", action: "block" },
    ]);
  });
});

describe("UPD nginx plan", () => {
  it("renders required variables and verifies the template checksum", () => {
    const template =
      "server { listen {{HTTP_PORT}}; proxy_pass http://${WEB_UPSTREAM}; proxy_set_header Host $host; }\n";
    const result = renderNginxTemplate({
      template,
      expectedTemplateSha256: sha256Text(template),
      requiredVariables: ["HTTP_PORT", "WEB_UPSTREAM"],
      variables: {
        HTTP_PORT: "80",
        WEB_UPSTREAM: "web:3000",
      },
    });

    expect(result.rendered).toContain("listen 80");
    expect(result.rendered).toContain("http://web:3000");
    expect(result.usedVariables).toEqual(["HTTP_PORT", "WEB_UPSTREAM"]);
  });

  it("rejects unresolved variables and checksum mismatches", () => {
    expect(() =>
      renderNginxTemplate({
        template: "server { listen {{HTTP_PORT}}; }\n",
        variables: {},
      }),
    ).toThrow(/unresolved variables/u);

    expect(() =>
      renderNginxTemplate({
        template: "server { listen 80; }\n",
        expectedTemplateSha256: sha256Text("other"),
        variables: {},
      }),
    ).toThrow(/checksum/u);
  });

  it("builds staging, active, rollback, and whitelist guarded paths", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "upd-nginx-"));
    const plan = buildNginxDeploymentPlan({
      rootDir,
      releaseId: "2026.05.22-001",
      renderedConfig: "server { listen 80; }\n",
      allowedRoots: [rootDir],
    });

    expect(plan.stagingConfigPath).toBe(
      path.join(rootDir, "staging", "default.conf"),
    );
    expect(plan.commandPlan.map((item) => item.id)).toContain(
      "nginx-test-staging",
    );
    expect(plan.rollbackCommandPlan.map((item) => item.id)).toContain(
      "rollback-active-nginx",
    );
    expect(() =>
      assertPathAllowed("/etc/nginx/default.conf", [rootDir]),
    ).toThrow(/outside allowed roots/u);
  });
});

describe("UPD backup plan", () => {
  it("plans pg, minio, compose, env, image, and nginx backups under /tmp", () => {
    const plan = buildBackupPlan({
      releaseId: "2026.05.22-001",
      env: {
        POSTGRES_DB: "crm_manager",
        POSTGRES_PASSWORD: "super-secret-password",
        MINIO_SECRET_KEY: "minio-secret-key",
      },
      apiImage: `registry.example.com/pdm/api@${apiDigest}`,
      webImage: `registry.example.com/pdm/web@${webDigest}`,
    });

    expectKinds(plan, [
      "postgres",
      "minio",
      "compose",
      "env",
      "image-refs",
      "nginx",
    ]);
    expect(plan.backupRoot).toContain("/tmp/pdm-updater/backups");
    expect(plan.redactedEnv.POSTGRES_PASSWORD).not.toContain(
      "super-secret-password",
    );
    expect(JSON.stringify(plan.items)).not.toContain("super-secret-password");
  });

  it("redacts token, password, secret, and access key values", () => {
    expect(
      redactEnv({
        UPD_GITHUB_TOKEN: "ghp_1234567890abcdef",
        MINIO_ACCESS_KEY: "access-key-value",
        WEB_APP_URL: "https://crm.example.com",
      }),
    ).toEqual({
      UPD_GITHUB_TOKEN: "ghp...cdef",
      MINIO_ACCESS_KEY: "acc...alue",
      WEB_APP_URL: "https://crm.example.com",
    });
  });
});

async function createSignedReleaseDir(): Promise<string> {
  const releaseDir = await createReleaseDir();
  const manifest = await buildReleaseManifestFromDirectory(
    releaseDir,
    buildManifestInput(),
  );
  const manifestPath = path.join(releaseDir, DEFAULT_MANIFEST_FILE);
  const signaturePath = path.join(releaseDir, DEFAULT_SIGNATURE_FILE);
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;

  await writeManifest(manifestPath, manifest);
  await writeManifestSignature(manifestPath, signaturePath, privateKeyPem);

  return releaseDir;
}

async function createReleaseDir(): Promise<string> {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), "upd-release-"));

  await writeFile(path.join(releaseDir, "release-notes.md"), "Release notes\n");
  await writeFile(path.join(releaseDir, "hook.sh"), "#!/bin/sh\ntrue\n");
  await writeFile(
    path.join(releaseDir, "nginx-default.conf"),
    "server { listen 80; }\n",
  );

  return releaseDir;
}

function buildManifestInput(): BuildReleaseManifestInput {
  return {
    manifestSchemaVersion: 1,
    version: "1.2.3",
    commit: "abc123",
    channel: "stable",
    publishedAt: "2026-05-22T00:00:00.000Z",
    minUpgradeableVersion: "1.0.0",
    minUpdaterVersion: "1.0.0",
    requiresMaintenance: false,
    riskLevel: "medium",
    images: {
      api: {
        image: `registry.example.com/pdm/api@${apiDigest}`,
        digest: apiDigest,
      },
      web: {
        image: `registry.example.com/pdm/web@${webDigest}`,
        digest: webDigest,
      },
    },
    dbSchemaMigrations: [],
    systemDataMigrations: [],
    nginx: {
      configVersion: "2026-05-22",
      templatePath: "nginx-default.conf",
      requiredVariables: ["PDM_WEB_UPSTREAM"],
      rollbackSupported: true,
    },
  };
}

class FakeSystemDataMigrationExecutor implements SystemDataMigrationExecutor {
  readonly records = new Map<string, SystemDataMigrationRecord>();

  findRecord(migrationId: string): SystemDataMigrationRecord | null {
    return this.records.get(migrationId) ?? null;
  }

  createRecord(record: SystemDataMigrationRecord): SystemDataMigrationRecord {
    if (this.records.has(record.migrationId)) {
      throw new Error(`duplicate migration id: ${record.migrationId}`);
    }

    this.records.set(record.migrationId, record);
    return record;
  }

  updateRecord(
    migrationId: string,
    patch: Partial<SystemDataMigrationRecord>,
  ): SystemDataMigrationRecord {
    const existing = this.records.get(migrationId);

    if (!existing) {
      throw new Error(`missing migration record: ${migrationId}`);
    }

    const updated = {
      ...existing,
      ...patch,
    };
    this.records.set(migrationId, updated);

    return updated;
  }
}

function expectKinds(
  plan: BackupPlan,
  expectedKinds: Array<BackupPlan["items"][number]["kind"]>,
): void {
  for (const expectedKind of expectedKinds) {
    expect(plan.items.some((item) => item.kind === expectedKind)).toBe(true);
  }
}
