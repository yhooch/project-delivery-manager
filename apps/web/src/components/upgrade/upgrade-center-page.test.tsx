import type {
  CheckUpdateResponse,
  UpdateManifest,
  UpdaterJob,
} from "@project-delivery/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { replaceMock, searchParamsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsMock: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.current,
}));
vi.mock("../../i18n/routing", () => ({
  usePathname: () => "/upgrade",
  useRouter: () => ({ replace: replaceMock }),
}));

const {
  checkUpdateMock,
  createUpdateJobMock,
  getUpdateJobMock,
  getUpdateStatusMock,
  rollbackUpdateJobMock,
} = vi.hoisted(() => ({
  checkUpdateMock: vi.fn(),
  createUpdateJobMock: vi.fn(),
  getUpdateJobMock: vi.fn(),
  getUpdateStatusMock: vi.fn(),
  rollbackUpdateJobMock: vi.fn(),
}));
vi.mock("../../lib/upgrade-service", () => ({
  checkUpdate: checkUpdateMock,
  createUpdateJob: createUpdateJobMock,
  getUpdateJob: getUpdateJobMock,
  getUpdateStatus: getUpdateStatusMock,
  rollbackUpdateJob: rollbackUpdateJobMock,
}));

import { UpgradeCenterPage } from "./upgrade-center-page";

const now = "2026-05-22T08:00:00.000Z";

function createManifest(): UpdateManifest {
  return {
    manifestSchemaVersion: 1,
    version: "1.2.0",
    commit: "abc1234",
    channel: "stable",
    publishedAt: now,
    minUpgradeableVersion: "1.0.0",
    minUpdaterVersion: "0.5.0",
    requiresMaintenance: true,
    riskLevel: "high",
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
    dbSchemaMigrations: [
      {
        id: "20260522010000",
        path: "prisma/migrations/20260522010000/migration.sql",
        sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        kind: "sql",
        required: true,
      },
    ],
    systemDataMigrations: [],
    nginx: {
      configVersion: "nginx-2026-05-22",
      templatePath: "nginx/app.conf",
      sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      requiredVariables: ["API_HOST"],
      rollbackSupported: true,
    },
    checksums: {
      "manifest.json":
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
  };
}

function createJob(overrides: Partial<UpdaterJob> = {}): UpdaterJob {
  return {
    id: "job-123",
    dryRun: false,
    status: "running",
    manifest: createManifest(),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    steps: [
      {
        id: "pull",
        title: "Pull images",
        status: "running",
        startedAt: now,
        logs: [
          {
            at: now,
            level: "info",
            message: "Pulling registry.local/api:1.2.0",
          },
        ],
      },
    ],
    commandPlan: [],
    rollback: {
      supported: true,
      status: "ready",
      targetVersion: "1.1.0",
      backups: [
        {
          id: "backup-db",
          createdAt: now,
          kind: "database",
          path: "/var/backups/db.sql",
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  searchParamsMock.current = new URLSearchParams();
  replaceMock.mockReset();
  getUpdateStatusMock.mockReset();
  checkUpdateMock.mockReset();
  createUpdateJobMock.mockReset();
  getUpdateJobMock.mockReset();
  rollbackUpdateJobMock.mockReset();
  window.localStorage.clear();
  getUpdateStatusMock.mockResolvedValue({
    phase: "idle",
    currentVersion: "1.1.0",
    currentCommit: "def5678",
    channel: "stable",
    updatedAt: now,
  });
});

afterEach(() => {
  cleanup();
});

describe("UpgradeCenterPage", () => {
  it("renders status summary after loading", async () => {
    render(<UpgradeCenterPage />);

    expect(
      screen.getByText("upgradeCenter.states.loading"),
    ).toBeInTheDocument();
    expect(await screen.findByText("1.1.0")).toBeInTheDocument();
    expect(screen.getByText("def5678")).toBeInTheDocument();
    expect(screen.getAllByText("upgradeCenter.phase.idle").length).toBeGreaterThan(
      0,
    );
  });

  it("shows a localized load error", async () => {
    getUpdateStatusMock.mockRejectedValueOnce(new Error("boom"));

    render(<UpgradeCenterPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.api.UNKNOWN",
    );
  });

  it("checks updates and renders manifest details", async () => {
    const result: CheckUpdateResponse = {
      status: "available",
      channel: "stable",
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      manifest: createManifest(),
      checkedAt: now,
    };
    checkUpdateMock.mockResolvedValue(result);

    render(<UpgradeCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: /check/u }));

    await waitFor(() =>
      expect(checkUpdateMock).toHaveBeenCalledWith({
        channel: "stable",
        force: true,
      }),
    );
    expect(screen.getAllByText("1.2.0").length).toBeGreaterThan(0);
    expect(screen.getByText("nginx-2026-05-22")).toBeInTheDocument();
    expect(screen.getByText("upgradeCenter.risk.high")).toBeInTheDocument();
  });

  it("creates a dry-run job from the checked manifest", async () => {
    checkUpdateMock.mockResolvedValue({
      status: "available",
      channel: "stable",
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      manifest: createManifest(),
      checkedAt: now,
    });
    createUpdateJobMock.mockResolvedValue(createJob({ dryRun: true }));
    getUpdateJobMock.mockResolvedValue(createJob({ dryRun: true }));

    render(<UpgradeCenterPage />);

    fireEvent.click(await screen.findByRole("button", { name: /check/u }));
    await screen.findByText("nginx-2026-05-22");
    fireEvent.click(
      screen.getByRole("button", { name: /upgradeCenter\.actions\.dryRun/u }),
    );

    await waitFor(() =>
      expect(createUpdateJobMock).toHaveBeenCalledWith({
        manifest: createManifest(),
        dryRun: true,
      }),
    );
    expect(replaceMock).toHaveBeenCalledWith("/upgrade?jobId=job-123", {
      scroll: false,
    });
    await waitFor(() => expect(getUpdateJobMock).toHaveBeenCalledWith("job-123"));
  });

  it("resumes polling an active job from updater status and can roll it back", async () => {
    getUpdateStatusMock.mockResolvedValue({
      phase: "applying",
      currentVersion: "1.1.0",
      currentCommit: "def5678",
      channel: "stable",
      activeJobId: "job-123",
      updatedAt: now,
    });
    getUpdateJobMock.mockResolvedValue(createJob());
    rollbackUpdateJobMock.mockResolvedValue(
      createJob({ status: "rolled_back", rollback: { ...createJob().rollback, status: "succeeded" } }),
    );

    render(<UpgradeCenterPage />);

    await waitFor(() => expect(getUpdateJobMock).toHaveBeenCalledWith("job-123"));
    expect(await screen.findByTestId("upgrade-active-job-summary")).toHaveTextContent(
      "Pull images",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /upgradeCenter\.actions\.rollback/u }),
    );

    await waitFor(() =>
      expect(rollbackUpdateJobMock).toHaveBeenCalledWith("job-123"),
    );
  });
});
