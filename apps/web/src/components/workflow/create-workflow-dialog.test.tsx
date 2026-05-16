import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  WorkflowDefinition,
  WorkflowVersion,
} from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<string, (key: string) => string>(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => (namespace ? `${namespace}.${k}` : k);
      translatorCache.set(key, fn);
    }
    return fn;
  },
}));

const {
  createWorkflowMock,
  createWorkflowVersionMock,
  listWorkflowVersionsMock,
  updateWorkflowMock,
} = vi.hoisted(() => ({
  createWorkflowMock: vi.fn(),
  createWorkflowVersionMock: vi.fn(),
  listWorkflowVersionsMock: vi.fn(),
  updateWorkflowMock: vi.fn(),
}));

vi.mock("../../lib/workflow-service", () => ({
  createWorkflow: createWorkflowMock,
  createWorkflowVersion: createWorkflowVersionMock,
  listWorkflowVersions: listWorkflowVersionsMock,
  updateWorkflow: updateWorkflowMock,
}));

import { CreateWorkflowDialog } from "./create-workflow-dialog";

const organizationId = "01ARZ3NDEKTSV4RRFFQ69G5FO1";
const spaceId = "01ARZ3NDEKTSV4RRFFQ69G5FS1";
const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const draftVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VD1";
const publishedVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VP1";

function makeWorkflow(): WorkflowDefinition {
  return {
    code: "BUG_FLOW",
    id: workflowId,
    name: "Bug Flow",
    organizationId,
    spaceId,
    status: "ACTIVE",
  };
}

function makeVersion(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    actions: [],
    id: draftVersionId,
    states: [],
    status: "DRAFT",
    version: 1,
    workflowId,
    ...overrides,
  };
}

function renderCopyDialog(onSuccess = vi.fn()) {
  render(
    <CreateWorkflowDialog
      context={{ organizationId, spaceId }}
      mode={{ kind: "copyVersion", workflow: makeWorkflow() }}
      onClose={vi.fn()}
      onSuccess={onSuccess}
      open
    />,
  );
}

function renderCreateDialog(onSuccess = vi.fn()) {
  render(
    <CreateWorkflowDialog
      context={{ organizationId, spaceId }}
      mode={{ kind: "create" }}
      onClose={vi.fn()}
      onSuccess={onSuccess}
      open
    />,
  );
}

beforeEach(() => {
  createWorkflowMock.mockReset();
  createWorkflowVersionMock.mockReset();
  listWorkflowVersionsMock.mockReset();
  updateWorkflowMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CreateWorkflowDialog", () => {
  it("creates the first draft version after creating a workflow", async () => {
    const onSuccess = vi.fn();
    createWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    createWorkflowVersionMock.mockResolvedValueOnce(makeVersion());

    renderCreateDialog(onSuccess);

    fireEvent.change(
      screen.getByLabelText("workflow.dialog.create.fields.name"),
      {
        target: { value: "Custom flow" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("workflow.dialog.create.fields.code"),
      {
        target: { value: "CUSTOM_FLOW" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "workflow.dialog.create.submit",
      }),
    );

    await waitFor(() =>
      expect(createWorkflowMock).toHaveBeenCalledWith(
        { organizationId, spaceId },
        {
          code: "CUSTOM_FLOW",
          description: undefined,
          name: "Custom flow",
        },
      ),
    );
    expect(createWorkflowVersionMock).toHaveBeenCalledWith(
      { organizationId, spaceId, workflowId },
      {},
    );
    expect(onSuccess).toHaveBeenCalledWith(makeWorkflow());
  });

  it("uses the latest published workflow version as the copy source", async () => {
    const newerPublishedVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VP2";
    listWorkflowVersionsMock.mockResolvedValueOnce({
      items: [
        makeVersion(),
        makeVersion({
          id: publishedVersionId,
          publishedAt: "2026-05-14T10:00:00.000Z",
          status: "PUBLISHED",
          version: 2,
        }),
        makeVersion({
          id: newerPublishedVersionId,
          publishedAt: "2026-05-15T10:00:00.000Z",
          status: "PUBLISHED",
          version: 3,
        }),
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    });
    createWorkflowVersionMock.mockResolvedValueOnce(
      makeVersion({ id: "01ARZ3NDEKTSV4RRFFQ69G5VN1", version: 3 }),
    );

    renderCopyDialog();

    await waitFor(() =>
      expect(listWorkflowVersionsMock).toHaveBeenCalledWith({
        organizationId,
        page: 1,
        pageSize: 50,
        spaceId,
        workflowId,
      }),
    );
    const sourceSelect = document.getElementById(
      "workflow-dialog-source-version",
    ) as HTMLSelectElement;
    expect(sourceSelect).not.toBeNull();
    await waitFor(() =>
      expect(sourceSelect.value).toBe(newerPublishedVersionId),
    );
    expect([...sourceSelect.options].map((option) => option.value)).toEqual([
      "",
      publishedVersionId,
      newerPublishedVersionId,
    ]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "workflow.dialog.copyVersion.submit",
      }),
    );

    await waitFor(() =>
      expect(createWorkflowVersionMock).toHaveBeenCalledWith(
        { organizationId, spaceId, workflowId },
        { sourceWorkflowVersionId: newerPublishedVersionId },
      ),
    );
  });

  it("does not submit when no published source exists", async () => {
    listWorkflowVersionsMock.mockResolvedValueOnce({
      items: [makeVersion()],
      page: 1,
      pageSize: 50,
      total: 1,
    });

    renderCopyDialog();

    await waitFor(() => expect(listWorkflowVersionsMock).toHaveBeenCalled());
    const submit = screen.getByRole("button", {
      name: "workflow.dialog.copyVersion.submit",
    });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);

    expect(createWorkflowVersionMock).not.toHaveBeenCalled();
  });
});
