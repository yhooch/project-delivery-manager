import type { UpdateManifest, UpdaterJob } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import {
  checkUpdate,
  createUpdateJob,
  getUpdateJob,
  getUpdateStatus,
  rollbackUpdateJob,
  type UpgradeApiTransport,
} from "./upgrade-service";

const checkedAt = "2026-05-22T08:00:00.000Z";

function createApi(
  overrides: Partial<Record<keyof UpgradeApiTransport, unknown>>,
): UpgradeApiTransport {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as UpgradeApiTransport;
}

function createManifest(): UpdateManifest {
  return {
    manifestSchemaVersion: 1,
    version: "1.2.0",
    commit: "abc1234",
    channel: "stable",
    publishedAt: checkedAt,
    minUpgradeableVersion: "1.0.0",
    minUpdaterVersion: "0.5.0",
    requiresMaintenance: true,
    riskLevel: "medium",
    images: {
      api: {
        image: "registry.local/api:1.2.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      web: {
        image: "registry.local/web:1.2.0",
        digest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
    dbSchemaMigrations: [],
    systemDataMigrations: [],
    nginx: {
      configVersion: "2026-05-22",
      templatePath: "nginx/app.conf",
      sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      requiredVariables: [],
      rollbackSupported: true,
    },
    checksums: {
      "manifest.json":
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  };
}

function createJob(overrides: Partial<UpdaterJob> = {}): UpdaterJob {
  return {
    id: "job-123",
    dryRun: false,
    status: "running",
    manifest: createManifest(),
    createdAt: checkedAt,
    updatedAt: checkedAt,
    steps: [],
    commandPlan: [],
    rollback: {
      supported: true,
      status: "ready",
      backups: [],
    },
    ...overrides,
  };
}

describe("upgrade service", () => {
  it("loads updater status through the shared schema", async () => {
    const status = {
      phase: "idle",
      currentVersion: "1.1.0",
      currentCommit: "def5678",
      channel: "stable",
      updatedAt: checkedAt,
    };
    const api = createApi({
      get: vi.fn(async () => ({ data: status })),
    });

    await expect(getUpdateStatus(api)).resolves.toEqual(status);

    expect(api.get).toHaveBeenCalledWith("/system/update/status");
  });

  it("checks for updates with defaulted request fields", async () => {
    const result = {
      status: "available",
      channel: "stable",
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      manifest: createManifest(),
      checkedAt,
    };
    const api = createApi({
      post: vi.fn(async () => ({ data: result })),
    });

    await expect(checkUpdate({ channel: "stable" }, api)).resolves.toEqual(
      result,
    );

    expect(api.post).toHaveBeenCalledWith("/system/update/check", {
      channel: "stable",
      force: false,
    });
  });

  it("creates, reads, and rolls back update jobs on the stable endpoints", async () => {
    const created = createJob({ dryRun: true });
    const rolledBack = createJob({ status: "rolled_back" });
    const api = createApi({
      get: vi.fn(async () => ({ data: created })),
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: created })
        .mockResolvedValueOnce({ data: rolledBack }),
    });

    await expect(
      createUpdateJob({ manifest: createManifest(), dryRun: true }, api),
    ).resolves.toEqual(created);
    await expect(getUpdateJob("job/123", api)).resolves.toEqual(created);
    await expect(rollbackUpdateJob("job/123", api)).resolves.toEqual(
      rolledBack,
    );

    expect(api.post).toHaveBeenNthCalledWith(1, "/system/update/jobs", {
      manifest: createManifest(),
      dryRun: true,
    });
    expect(api.get).toHaveBeenCalledWith("/system/update/jobs/job%2F123");
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/system/update/jobs/job%2F123/rollback",
      {},
    );
  });
});
