import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HttpStatus } from "@nestjs/common";
import type { UpdateManifest } from "@project-delivery/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiException } from "../../http/api-exception";
import {
  StateFileSystemUpdateClient,
  UPDATER_SECRET_HEADER,
  UpdaterHttpClient,
} from "./system-update.client";

const now = "2026-05-22T00:00:00.000Z";

describe("UpdaterHttpClient", () => {
  it("sends the shared secret header to the local updater", async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        [UPDATER_SECRET_HEADER]: "secret",
      });

      return jsonResponse({
        phase: "idle",
        updatedAt: now,
      });
    });
    const client = new UpdaterHttpClient(
      "http://127.0.0.1:3900",
      "secret",
      fetchImpl as typeof fetch,
    );

    await expect(client.getStatus()).resolves.toMatchObject({ phase: "idle" });
    expect(fetchImpl.mock.calls[0]?.[0]?.toString()).toBe(
      "http://127.0.0.1:3900/status",
    );
  });

  it("rejects non-local updater base URLs", () => {
    expect(
      () => new UpdaterHttpClient("https://updates.example.com", "secret"),
    ).toThrow(ApiException);
  });

  it("maps updater error bodies to shared update error codes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          code: "UPDATE_JOB_NOT_FOUND",
          message: "job missing",
        },
        404,
      ),
    );
    const client = new UpdaterHttpClient(
      "http://localhost:3900",
      "secret",
      fetchImpl as typeof fetch,
    );

    await expect(client.getJob("job-1")).rejects.toMatchObject({
      code: "UPDATE_JOB_NOT_FOUND",
      message: "job missing",
    });

    try {
      await client.getJob("job-1");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });
});

describe("StateFileSystemUpdateClient", () => {
  it("reads status and jobs from persisted JSON files", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "upd-api-state-"));
    const client = new StateFileSystemUpdateClient(stateDir);
    const job = {
      id: "job-1",
      dryRun: true,
      status: "queued",
      manifest: buildManifest(),
      createdAt: now,
      updatedAt: now,
      steps: [],
      commandPlan: [],
      rollback: {
        supported: true,
        status: "not_started",
        backups: [],
      },
    };

    await mkdir(path.join(stateDir, "jobs"), { recursive: true });
    await writeFile(
      path.join(stateDir, "status.json"),
      JSON.stringify({ phase: "idle", updatedAt: now }),
    );
    await writeFile(
      path.join(stateDir, "jobs", "job-1.json"),
      JSON.stringify(job),
    );

    await expect(client.getStatus()).resolves.toMatchObject({ phase: "idle" });
    await expect(client.getJob("job-1")).resolves.toMatchObject({
      id: "job-1",
    });
  });

  it("does not fabricate write operations without an HTTP updater", async () => {
    const client = new StateFileSystemUpdateClient("/tmp/missing-upd-state");

    await expect(client.check({ force: false })).rejects.toMatchObject({
      code: "UPDATE_PROVIDER_UNAVAILABLE",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function buildManifest(): UpdateManifest {
  return {
    manifestSchemaVersion: 1,
    version: "1.2.3",
    commit: "abc123",
    channel: "stable",
    publishedAt: now,
    minUpgradeableVersion: "1.0.0",
    minUpdaterVersion: "1.0.0",
    requiresMaintenance: false,
    riskLevel: "low",
    images: {
      api: {
        image:
          "registry.example.com/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      web: {
        image:
          "registry.example.com/web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        digest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
    dbSchemaMigrations: [],
    systemDataMigrations: [],
    nginx: {
      configVersion: "2026-05-22",
      templatePath: "nginx/default.conf",
      sha256: "c".repeat(64),
      requiredVariables: [],
      rollbackSupported: true,
    },
    checksums: {
      "nginx/default.conf": "c".repeat(64),
    },
  };
}
