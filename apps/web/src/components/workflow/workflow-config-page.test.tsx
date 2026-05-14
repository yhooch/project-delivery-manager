import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  WorkflowActionSummary,
  WorkflowDefinition,
  WorkflowState,
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
  useLocale: () => "zh-CN",
}));

vi.mock("../../i18n/routing", () => ({
  routing: { defaultLocale: "zh-CN", locales: ["zh-CN", "en-US"] },
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  getPathname: () => "/",
  redirect: () => undefined,
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  getWorkflowMock,
  listWorkflowVersionsMock,
  getWorkflowVersionMock,
  publishWorkflowVersionMock,
  updateWorkflowVersionMock,
  createWorkflowVersionMock,
  createWorkflowStateMock,
  updateWorkflowStateMock,
  deleteWorkflowStateMock,
  createWorkflowActionMock,
  updateWorkflowActionMock,
  deleteWorkflowActionMock,
  createActionFormFieldMock,
  updateActionFormFieldMock,
  deleteActionFormFieldMock,
} = vi.hoisted(() => ({
  getWorkflowMock: vi.fn(),
  listWorkflowVersionsMock: vi.fn(),
  getWorkflowVersionMock: vi.fn(),
  publishWorkflowVersionMock: vi.fn(),
  updateWorkflowVersionMock: vi.fn(),
  createWorkflowVersionMock: vi.fn(),
  createWorkflowStateMock: vi.fn(),
  updateWorkflowStateMock: vi.fn(),
  deleteWorkflowStateMock: vi.fn(),
  createWorkflowActionMock: vi.fn(),
  updateWorkflowActionMock: vi.fn(),
  deleteWorkflowActionMock: vi.fn(),
  createActionFormFieldMock: vi.fn(),
  updateActionFormFieldMock: vi.fn(),
  deleteActionFormFieldMock: vi.fn(),
}));

vi.mock("../../lib/workflow-service", () => ({
  getWorkflow: getWorkflowMock,
  listWorkflowVersions: listWorkflowVersionsMock,
  getWorkflowVersion: getWorkflowVersionMock,
  publishWorkflowVersion: publishWorkflowVersionMock,
  updateWorkflowVersion: updateWorkflowVersionMock,
  createWorkflowVersion: createWorkflowVersionMock,
  createWorkflowState: createWorkflowStateMock,
  updateWorkflowState: updateWorkflowStateMock,
  deleteWorkflowState: deleteWorkflowStateMock,
  createWorkflowAction: createWorkflowActionMock,
  updateWorkflowAction: updateWorkflowActionMock,
  deleteWorkflowAction: deleteWorkflowActionMock,
  createActionFormField: createActionFormFieldMock,
  updateActionFormField: updateActionFormFieldMock,
  deleteActionFormField: deleteActionFormFieldMock,
}));

import { WorkflowConfigPage } from "./workflow-config-page";

const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const draftVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VV1";
const publishedVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VV2";
const stateOpenId = "01ARZ3NDEKTSV4RRFFQ69G5ST1";
const stateDoneId = "01ARZ3NDEKTSV4RRFFQ69G5ST2";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5AC1";
const fieldId = "01ARZ3NDEKTSV4RRFFQ69G5FD1";

function makeWorkflow(): WorkflowDefinition {
  return {
    code: "BUG_DEFAULT",
    description: "Default workflow",
    id: workflowId,
    name: "Bug Default",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    status: "ACTIVE",
  };
}

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    category: "NOT_STARTED",
    code: "OPEN",
    id: stateOpenId,
    isEnd: false,
    isStart: true,
    name: "Open",
    order: 0,
    workflowVersionId: draftVersionId,
    ...overrides,
  };
}

function makeAction(
  overrides: Partial<WorkflowActionSummary> = {},
): WorkflowActionSummary {
  return {
    actorRelations: ["ASSIGNEE"],
    allowedSpaceRoles: ["DEVELOPER"],
    code: "RESOLVE",
    formFields: [
      {
        fieldType: "TEXTAREA",
        id: fieldId,
        key: "note",
        label: "Note",
        order: 0,
        required: false,
      },
    ],
    fromStateId: stateOpenId,
    id: actionId,
    name: "Resolve",
    order: 0,
    requiresComment: false,
    toStateId: stateDoneId,
    ...overrides,
  };
}

function makeDraftVersion(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    actions: [makeAction()],
    id: draftVersionId,
    states: [
      makeState(),
      makeState({
        category: "DONE",
        code: "DONE",
        id: stateDoneId,
        isEnd: true,
        isStart: false,
        name: "Done",
        order: 1,
      }),
    ],
    status: "DRAFT",
    version: 2,
    workflowId,
    ...overrides,
  };
}

function makePublishedVersion(): WorkflowVersion {
  return {
    actions: [],
    id: publishedVersionId,
    states: [makeState({ id: stateOpenId, name: "Open", order: 0 })],
    status: "PUBLISHED",
    publishedAt: "2026-05-13T10:00:00.000Z",
    version: 1,
    workflowId,
  };
}

function setupVersions(versions: WorkflowVersion[]) {
  listWorkflowVersionsMock.mockResolvedValue({
    items: versions,
    page: 1,
    pageSize: 20,
    total: versions.length,
  });
}

beforeEach(() => {
  getWorkflowMock.mockReset();
  listWorkflowVersionsMock.mockReset();
  getWorkflowVersionMock.mockReset();
  publishWorkflowVersionMock.mockReset();
  updateWorkflowVersionMock.mockReset();
  createWorkflowVersionMock.mockReset();
  createWorkflowStateMock.mockReset();
  updateWorkflowStateMock.mockReset();
  deleteWorkflowStateMock.mockReset();
  createWorkflowActionMock.mockReset();
  updateWorkflowActionMock.mockReset();
  deleteWorkflowActionMock.mockReset();
  createActionFormFieldMock.mockReset();
  updateActionFormFieldMock.mockReset();
  deleteActionFormFieldMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: { id: "SPC_01", organizationId: "ORG_01", name: "Space A" },
    status: "authenticated" as const,
  };
});

afterEach(() => {
  cleanup();
});

describe("WorkflowConfigPage", () => {
  it("renders the version selector, state table, and action list for a draft version", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makePublishedVersion(), makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: draftVersionId,
      }),
    );

    const select = (await screen.findByTestId(
      "workflow-config-version-select",
    )) as HTMLSelectElement;
    expect(select.value).toBe(draftVersionId);

    expect(screen.getByTestId("workflow-state-table")).toBeInTheDocument();
    expect(screen.getByTestId(`workflow-state-row-${stateOpenId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflow-state-row-${stateDoneId}`)).toBeInTheDocument();

    expect(screen.getByTestId("workflow-action-list")).toBeInTheDocument();
    expect(screen.getByTestId(`workflow-action-row-${actionId}`)).toBeInTheDocument();
  });

  it("re-fetches the version when the dropdown changes", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makePublishedVersion(), makeDraftVersion()]);
    getWorkflowVersionMock
      .mockResolvedValueOnce(makeDraftVersion())
      .mockResolvedValueOnce(makePublishedVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const select = (await screen.findByTestId(
      "workflow-config-version-select",
    )) as HTMLSelectElement;

    await waitFor(() => expect(getWorkflowVersionMock).toHaveBeenCalledTimes(1));

    fireEvent.change(select, { target: { value: publishedVersionId } });

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenLastCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: publishedVersionId,
      }),
    );
  });

  it("disables write buttons and shows the readonly hint for a published version", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makePublishedVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId("workflow-config-readonly-hint");

    const publish = screen.getByTestId("workflow-config-publish");
    expect(publish).toBeDisabled();
    const disable = screen.getByTestId("workflow-config-disable");
    expect(disable).not.toBeDisabled();

    const stateNewBtn = screen.getByRole("button", {
      name: /workflow\.config\.states\.create/,
    });
    expect(stateNewBtn).toBeDisabled();
    const actionNewBtn = screen.getByRole("button", {
      name: /workflow\.config\.actions\.create/,
    });
    expect(actionNewBtn).toBeDisabled();

    const editBtn = screen.getByRole("button", {
      name: /workflow\.config\.states\.actions\.edit/,
    });
    expect(editBtn).toBeDisabled();
  });

  it("enables publish on a draft and disables disable button", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());
    const disable = screen.getByTestId("workflow-config-disable");
    expect(disable).toBeDisabled();
  });

  it("blocks publish when start state is missing and lists the issue", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    const broken = makeDraftVersion({
      states: [
        makeState({ isStart: false }),
        makeState({
          category: "DONE",
          code: "DONE",
          id: stateDoneId,
          isEnd: true,
          isStart: false,
          name: "Done",
          order: 1,
        }),
      ],
    });
    setupVersions([broken]);
    getWorkflowVersionMock.mockResolvedValueOnce(broken);

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());

    fireEvent.click(publish);

    await screen.findByTestId("workflow-config-publish-issues");
    expect(
      screen.getByText("workflow.config.publishValidation.issues.noStartState"),
    ).toBeInTheDocument();
    expect(publishWorkflowVersionMock).not.toHaveBeenCalled();
  });

  it("publishes a valid draft version and refreshes shell", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());
    publishWorkflowVersionMock.mockResolvedValueOnce({
      ...makeDraftVersion(),
      status: "PUBLISHED",
      publishedAt: "2026-05-14T10:00:00.000Z",
    });

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());

    fireEvent.click(publish);

    await waitFor(() =>
      expect(publishWorkflowVersionMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: draftVersionId,
      }),
    );
  });

  it("disables a published version via updateWorkflowVersion", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makePublishedVersion());
    updateWorkflowVersionMock.mockResolvedValueOnce({
      ...makePublishedVersion(),
      status: "DISABLED",
    });

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const disable = await screen.findByTestId("workflow-config-disable");
    await waitFor(() => expect(disable).not.toBeDisabled());

    fireEvent.click(disable);

    await waitFor(() =>
      expect(updateWorkflowVersionMock).toHaveBeenCalledWith(
        {
          organizationId: "ORG_01",
          spaceId: "SPC_01",
          workflowVersionId: publishedVersionId,
        },
        { status: "DISABLED" },
      ),
    );
  });

  it("creates a new draft version when copy-as-new-version is clicked", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makePublishedVersion());
    createWorkflowVersionMock.mockResolvedValueOnce({
      ...makeDraftVersion(),
      id: "01ARZ3NDEKTSV4RRFFQ69G5VV9",
    });

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const copy = await screen.findByTestId("workflow-config-copy-draft");
    await waitFor(() => expect(copy).not.toBeDisabled());

    fireEvent.click(copy);

    await waitFor(() =>
      expect(createWorkflowVersionMock).toHaveBeenCalledWith(
        { organizationId: "ORG_01", spaceId: "SPC_01", workflowId },
        { sourceWorkflowVersionId: publishedVersionId },
      ),
    );
  });

  it("calls deleteWorkflowState when state delete is clicked on a draft version", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());
    deleteWorkflowStateMock.mockResolvedValueOnce({});

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId(`workflow-state-row-${stateOpenId}`);

    const deleteBtns = screen.getAllByRole("button", {
      name: /workflow\.config\.states\.actions\.delete/,
    });
    fireEvent.click(deleteBtns[0]!);

    await waitFor(() =>
      expect(deleteWorkflowStateMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        stateId: stateOpenId,
      }),
    );
  });

  it("calls deleteWorkflowAction when action delete is clicked on a draft version", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());
    deleteWorkflowActionMock.mockResolvedValueOnce({});

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId(`workflow-action-row-${actionId}`);

    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.actions\.actions\.delete/,
      }),
    );

    await waitFor(() =>
      expect(deleteWorkflowActionMock).toHaveBeenCalledWith({
        actionId,
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      }),
    );
  });

  it("expands an action and triggers field create dialog from the form-field list", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const toggle = await screen.findByRole("button", {
      name: /workflow\.config\.actions\.actions\.toggleFields/,
    });
    fireEvent.click(toggle);

    expect(
      await screen.findByTestId("workflow-form-field-table"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`workflow-form-field-row-${fieldId}`),
    ).toBeInTheDocument();

    const newField = screen.getByRole("button", {
      name: /workflow\.config\.fields\.create/,
    });
    expect(newField).not.toBeDisabled();
    fireEvent.click(newField);

    expect(
      await screen.findByText("workflow.config.fieldDialog.create.title"),
    ).toBeInTheDocument();
  });

  it("opens the state edit dialog when a state row edit button is clicked", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId(`workflow-state-row-${stateOpenId}`);

    const editBtns = screen.getAllByRole("button", {
      name: /workflow\.config\.states\.actions\.edit/,
    });
    fireEvent.click(editBtns[0]!);

    expect(
      await screen.findByText("workflow.config.stateDialog.edit.title"),
    ).toBeInTheDocument();
  });

  it("opens the action create dialog when 新增动作 is clicked", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const newAction = await screen.findByRole("button", {
      name: /workflow\.config\.actions\.create/,
    });
    fireEvent.click(newAction);

    expect(
      await screen.findByText("workflow.config.actionDialog.create.title"),
    ).toBeInTheDocument();
  });
});
