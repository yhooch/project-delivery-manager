import { describe, expect, it } from "vitest";

import {
  UpdateErrorCodeSchema,
  UpdateManifestSchema,
  UpdaterJobSchema,
  UpdaterStatusSchema,
} from "./update";

const sha256 = "a".repeat(64);
const digest = `sha256:${"b".repeat(64)}`;

function buildManifestInput() {
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
        image: `registry.example.com/pdm/api@${digest}`,
        digest,
      },
      web: {
        image: `registry.example.com/pdm/web@${digest}`,
        digest,
      },
    },
    dbSchemaMigrations: [
      {
        id: "202605220001",
        path: "migrations/202605220001.sql",
        sha256,
        kind: "sql",
      },
    ],
    systemDataMigrations: [],
    nginx: {
      configVersion: "2026-05-22",
      templatePath: "nginx/default.conf",
      sha256,
      requiredVariables: ["PDM_WEB_UPSTREAM"],
      rollbackSupported: true,
    },
    checksums: {
      "nginx/default.conf": sha256,
      "migrations/202605220001.sql": sha256,
      "release-notes.md": sha256,
    },
  };
}

describe("UpdateManifestSchema", () => {
  it("accepts the required UPD release manifest shape", () => {
    expect(UpdateManifestSchema.parse(buildManifestInput())).toMatchObject({
      manifestSchemaVersion: 1,
      riskLevel: "medium",
      images: {
        api: {
          digest,
        },
        web: {
          digest,
        },
      },
    });
  });

  it("requires api and web image digests", () => {
    const manifest = buildManifestInput();
    delete (manifest.images.web as Partial<typeof manifest.images.web>).digest;

    expect(() => UpdateManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects path traversal in checksum keys", () => {
    const manifest = buildManifestInput();
    (manifest.checksums as Record<string, string>)["../secret.env"] = sha256;

    expect(() => UpdateManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects the deprecated schemaVersion field name", () => {
    const manifest = {
      ...buildManifestInput(),
      schemaVersion: 1,
    };
    delete (manifest as Partial<typeof manifest>).manifestSchemaVersion;

    expect(() => UpdateManifestSchema.parse(manifest)).toThrow();
  });
});

describe("Update DTO schemas", () => {
  it("exports the required update error codes", () => {
    expect(
      UpdateErrorCodeSchema.options.filter((code) =>
        [
          "UPDATE_ACCESS_DENIED",
          "PLATFORM_OPERATOR_REQUIRED",
          "UPDATE_MANIFEST_INVALID",
          "UPDATE_CHECKSUM_MISMATCH",
          "UPDATE_SIGNATURE_INVALID",
          "UPDATE_UPDATER_TOO_OLD",
          "UPDATE_VERSION_INCOMPATIBLE",
          "UPDATE_DIGEST_MISMATCH",
        ].includes(code),
      ),
    ).toHaveLength(8);
  });

  it("parses persisted updater status and job detail DTOs", () => {
    const updatedAt = "2026-05-22T00:00:00.000Z";
    const manifest = UpdateManifestSchema.parse(buildManifestInput());
    const status = UpdaterStatusSchema.parse({
      phase: "idle",
      currentVersion: "1.0.0",
      channel: "stable",
      updatedAt,
    });

    expect(status.phase).toBe("idle");
    expect(
      UpdaterJobSchema.parse({
        id: "job-1",
        dryRun: true,
        status: "queued",
        manifest,
        createdAt: updatedAt,
        updatedAt,
        steps: [
          {
            id: "validate",
            title: "Validate release package",
            status: "pending",
            logs: [],
          },
        ],
        commandPlan: [
          {
            id: "pull-images",
            description: "Pull release images by digest",
            command: ["docker", "compose", "pull", "api", "web"],
            requiresPrivilege: true,
          },
        ],
        rollback: {
          supported: true,
          status: "not_started",
          backups: [],
        },
      }),
    ).toMatchObject({
      id: "job-1",
      dryRun: true,
      status: "queued",
    });
  });
});
