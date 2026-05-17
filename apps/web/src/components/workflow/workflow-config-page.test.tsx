import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  WorkflowActionConfigSummary,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rootMessages, translatorCache } = vi.hoisted(() => ({
  rootMessages: new Map<string, string>(),
  translatorCache: new Map<string, (key: string) => string>(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string) => {
        const messageKey = namespace ? `${namespace}.${k}` : k;
        return namespace ? messageKey : (rootMessages.get(k) ?? messageKey);
      };
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
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "SPACE_ADMIN",
    },
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
  listWorkflowBindingsMock,
  createWorkflowBindingMock,
  updateWorkflowBindingMock,
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
  listWorkflowBindingsMock: vi.fn(),
  createWorkflowBindingMock: vi.fn(),
  updateWorkflowBindingMock: vi.fn(),
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
  listWorkflowBindings: listWorkflowBindingsMock,
  createWorkflowBinding: createWorkflowBindingMock,
  updateWorkflowBinding: updateWorkflowBindingMock,
}));

import { ApiClientError } from "../../lib/api-client";

import { WorkflowConfigPage } from "./workflow-config-page";

const workflowId = "01ARZ3NDEKTSV4RRFFQ69G5FW1";
const draftVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VV1";
const publishedVersionId = "01ARZ3NDEKTSV4RRFFQ69G5VV2";
const stateOpenId = "01ARZ3NDEKTSV4RRFFQ69G5ST1";
const stateDoneId = "01ARZ3NDEKTSV4RRFFQ69G5ST2";
const actionId = "01ARZ3NDEKTSV4RRFFQ69G5AC1";
const fieldId = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const bindingId = "01ARZ3NDEKTSV4RRFFQ69G5BD1";

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    code: "BUG_DEFAULT",
    description: "Default workflow",
    id: workflowId,
    name: "Bug Default",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    status: "ACTIVE",
    ...overrides,
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
  overrides: Partial<WorkflowActionConfigSummary> = {},
): WorkflowActionConfigSummary {
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

function makeBinding(
  overrides: Partial<WorkflowBinding> = {},
): WorkflowBinding {
  return {
    id: bindingId,
    isDefault: true,
    organizationId: "ORG_01",
    priority: "HIGH",
    spaceId: "SPC_01",
    workflowId,
    workflowVersionId: draftVersionId,
    workItemType: "BUG",
    ...overrides,
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

function setupBindings(bindings: WorkflowBinding[]) {
  listWorkflowBindingsMock.mockImplementation(
    (input: { workflowId?: string }) => {
      const items = input.workflowId
        ? bindings.filter((binding) => binding.workflowId === input.workflowId)
        : bindings;

      return Promise.resolve({
        items,
        page: 1,
        pageSize: 100,
        total: items.length,
      });
    },
  );
}

beforeEach(() => {
  rootMessages.clear();
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
  listWorkflowBindingsMock.mockReset();
  createWorkflowBindingMock.mockReset();
  updateWorkflowBindingMock.mockReset();
  setupBindings([]);
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      role: "SPACE_ADMIN",
    },
    status: "authenticated" as const,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkflowConfigPage", () => {
  it("localizes built-in default workflow configuration labels by stable codes", async () => {
    rootMessages.set(
      "common.workflowDefaults.definitions.BUG.name",
      "Bug default workflow",
    );
    rootMessages.set(
      "common.workflowDefaults.definitions.BUG.description",
      "Built-in bug workflow for defect confirmation, fixing, regression, and closure.",
    );
    rootMessages.set(
      "common.workflowDefaults.states.PENDING_CONFIRMATION",
      "Pending confirmation",
    );
    rootMessages.set(
      "common.workflowDefaults.states.PENDING_FIX",
      "Pending fix",
    );
    rootMessages.set(
      "common.workflowDefaults.actions.CONFIRM_DEFECT",
      "Confirm defect",
    );
    rootMessages.set(
      "common.workflowDefaults.fields.fixAssigneeId",
      "Fix assignee",
    );
    const versionWithChineseDefaults = makeDraftVersion({
      actions: [
        makeAction({
          code: "CONFIRM_DEFECT",
          formFields: [
            {
              fieldType: "USER",
              id: fieldId,
              key: "fixAssigneeId",
              label: "修复负责人",
              order: 0,
              required: true,
            },
          ],
          name: "确认缺陷",
          toStateId: stateDoneId,
        }),
      ],
      states: [
        makeState({
          code: "PENDING_CONFIRMATION",
          name: "待确认",
        }),
        makeState({
          category: "WAITING",
          code: "PENDING_FIX",
          id: stateDoneId,
          isEnd: false,
          isStart: false,
          name: "待修复",
          order: 1,
        }),
      ],
    });
    getWorkflowMock.mockResolvedValueOnce(
      makeWorkflow({
        code: "BUG",
        description: "系统内置 Bug 流程，用于缺陷确认、修复、回归和关闭。",
        name: "Bug 默认流程",
      }),
    );
    setupVersions([versionWithChineseDefaults]);
    getWorkflowVersionMock.mockResolvedValueOnce(versionWithChineseDefaults);

    render(<WorkflowConfigPage workflowId={workflowId} />);

    expect(await screen.findByText("Bug default workflow")).toBeInTheDocument();
    expect(screen.queryByText("Bug 默认流程")).not.toBeInTheDocument();
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
    expect(screen.getByText("Pending fix")).toBeInTheDocument();
    expect(screen.getByText("Confirm defect")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.actions\.actions\.toggleFields/,
      }),
    );

    expect(await screen.findByText("Fix assignee")).toBeInTheDocument();
    expect(screen.queryByText("修复负责人")).not.toBeInTheDocument();
  });

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
    expect(
      screen.getByTestId(`workflow-state-row-${stateOpenId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`workflow-state-row-${stateDoneId}`),
    ).toBeInTheDocument();

    expect(screen.getByTestId("workflow-action-list")).toBeInTheDocument();
    expect(
      screen.getByTestId(`workflow-action-row-${actionId}`),
    ).toBeInTheDocument();
  });

  it("renders workflow bindings for the selected workflow", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    setupBindings([
      makeBinding(),
      makeBinding({
        id: "01ARZ3NDEKTSV4RRFFQ69G5BD2",
        workflowId: "01ARZ3NDEKTSV4RRFFQ69G5FW9",
      }),
    ]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    expect(
      await screen.findByTestId("workflow-binding-table"),
    ).toBeInTheDocument();
    expect(listWorkflowBindingsMock).toHaveBeenCalledWith({
      organizationId: "ORG_01",
      page: 1,
      pageSize: 100,
      spaceId: "SPC_01",
      workflowId,
    });
    expect(
      screen.getByTestId(`workflow-binding-row-${bindingId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-config-list-summary"),
    ).toHaveTextContent("workflow.config.toolbar.versionCount");
    expect(
      screen.getByTestId("workflow-config-list-summary"),
    ).toHaveTextContent("workflow.config.toolbar.targetTypes");
    expect(
      screen.getByTestId("workflow-config-list-summary"),
    ).toHaveTextContent("workflow.config.toolbar.defaultBindings");
    expect(
      screen.queryByTestId("workflow-binding-row-01ARZ3NDEKTSV4RRFFQ69G5BD2"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /workflow\.config\.bindings\.create/,
      }),
    ).toBeDisabled();
  });

  it("enables binding creation only for a published selected version", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    setupBindings([
      makeBinding({
        workflowVersionId: publishedVersionId,
      }),
    ]);
    getWorkflowVersionMock.mockResolvedValueOnce(makePublishedVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const createBinding = await screen.findByRole("button", {
      name: /workflow\.config\.bindings\.create/,
    });
    expect(createBinding).not.toBeDisabled();
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

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(select, { target: { value: publishedVersionId } });

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenLastCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: publishedVersionId,
      }),
    );
  });

  it("ignores stale version responses when the selected version changes quickly", async () => {
    let resolveDraft: (value: WorkflowVersion) => void = () => {};
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makePublishedVersion(), makeDraftVersion()]);
    getWorkflowVersionMock.mockImplementation(
      (input: { workflowVersionId: string }) => {
        if (input.workflowVersionId === draftVersionId) {
          return new Promise<WorkflowVersion>((resolve) => {
            resolveDraft = resolve;
          });
        }
        return Promise.resolve(makePublishedVersion());
      },
    );

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const select = (await screen.findByTestId(
      "workflow-config-version-select",
    )) as HTMLSelectElement;

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: draftVersionId,
      }),
    );

    fireEvent.change(select, { target: { value: publishedVersionId } });

    await waitFor(() =>
      expect(getWorkflowVersionMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        workflowVersionId: publishedVersionId,
      }),
    );
    expect(
      await screen.findByTestId("workflow-config-version-status"),
    ).toHaveTextContent("workflow.versionStatus.PUBLISHED");

    await act(async () => {
      resolveDraft(makeDraftVersion());
    });

    expect(
      screen.getByTestId("workflow-config-version-status"),
    ).toHaveTextContent("workflow.versionStatus.PUBLISHED");
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

  it("allows PM to manage a draft workflow version", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace,
        role: "PM",
      },
    };
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());
    expect(
      screen.queryByTestId("workflow-config-readonly-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /workflow\.config\.states\.create/,
      }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /workflow\.config\.actions\.create/,
      }),
    ).not.toBeDisabled();
  });

  it("uses the session default space role when currentSpace is unavailable", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: "SPC_01",
        spaces: [
          {
            code: "SPACE_A",
            id: "SPC_01",
            name: "Space A",
            organizationId: "ORG_01",
            role: "PM",
            status: "ACTIVE",
          },
        ],
      } as unknown as typeof sessionMock.current.session,
      currentSpace: undefined as unknown as never,
      status: "authenticated" as const,
    };
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());
    expect(
      screen.queryByTestId("workflow-config-readonly-hint"),
    ).not.toBeInTheDocument();
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

  it("blocks publish when more than one start state exists", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    const broken = makeDraftVersion({
      states: [
        makeState(),
        makeState({
          category: "DONE",
          code: "DONE",
          id: stateDoneId,
          isEnd: true,
          isStart: true,
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
      screen.getByText(
        "workflow.config.publishValidation.issues.multipleStartStates",
      ),
    ).toBeInTheDocument();
    expect(publishWorkflowVersionMock).not.toHaveBeenCalled();
  });

  it("blocks publish when a non-end state has no outgoing action", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    const reviewStateId = "01ARZ3NDEKTSV4RRFFQ69G5ST3";
    const broken = makeDraftVersion({
      actions: [makeAction({ toStateId: reviewStateId })],
      states: [
        makeState(),
        makeState({
          category: "VERIFYING",
          code: "REVIEW",
          id: reviewStateId,
          isEnd: false,
          isStart: false,
          name: "Review",
          order: 1,
        }),
        makeState({
          category: "DONE",
          code: "DONE",
          id: stateDoneId,
          isEnd: true,
          isStart: false,
          name: "Done",
          order: 2,
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
      screen.getByText(
        "workflow.config.publishValidation.issues.missingOutgoingAction",
      ),
    ).toBeInTheDocument();
    expect(publishWorkflowVersionMock).not.toHaveBeenCalled();
  });

  it("blocks publish when a state is unreachable from the start state", async () => {
    getWorkflowMock.mockResolvedValueOnce(makeWorkflow());
    const reviewStateId = "01ARZ3NDEKTSV4RRFFQ69G5ST3";
    const broken = makeDraftVersion({
      actions: [
        makeAction(),
        makeAction({
          code: "FINISH_REVIEW",
          fromStateId: reviewStateId,
          id: "01ARZ3NDEKTSV4RRFFQ69G5AC2",
          toStateId: stateDoneId,
        }),
      ],
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
        makeState({
          category: "VERIFYING",
          code: "REVIEW",
          id: reviewStateId,
          isEnd: false,
          isStart: false,
          name: "Review",
          order: 2,
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
      screen.getByText(
        "workflow.config.publishValidation.issues.unreachableState",
      ),
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

  it("renders backend publish validation issue details when publish rejects", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValueOnce(makeDraftVersion());
    publishWorkflowVersionMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "WORKFLOW_PUBLISH_VALIDATION_FAILED",
          details: {
            issues: [
              {
                code: "CUSTOM_BACKEND_CHECK",
                message: "A backend-only publish check failed.",
                stateId: stateOpenId,
              },
            ],
          },
          message: "Workflow publish validation failed",
          requestId: "REQ_01",
        },
        { status: 400 } as Response,
      ),
    );

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const publish = await screen.findByTestId("workflow-config-publish");
    await waitFor(() => expect(publish).not.toBeDisabled());

    fireEvent.click(publish);

    expect(
      await screen.findByText("errors.api.WORKFLOW_PUBLISH_VALIDATION_FAILED"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("workflow-config-publish-server-issues"),
    ).toHaveTextContent(
      `CUSTOM_BACKEND_CHECK: A backend-only publish check failed. (${stateOpenId})`,
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

  it("disables copy-as-new-version for an editable draft version", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const copy = await screen.findByTestId("workflow-config-copy-draft");
    await waitFor(() => expect(copy).toBeDisabled());

    fireEvent.click(copy);

    expect(createWorkflowVersionMock).not.toHaveBeenCalled();
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

    expect(
      await screen.findByTestId("workflow-delete-confirm-dialog"),
    ).toHaveTextContent("workflow.config.deleteConfirm.description");
    fireEvent.click(screen.getByTestId("workflow-delete-confirm"));

    await waitFor(() =>
      expect(deleteWorkflowStateMock).toHaveBeenCalledWith({
        organizationId: "ORG_01",
        spaceId: "SPC_01",
        stateId: stateOpenId,
      }),
    );
  });

  it("does not delete workflow state when delete confirmation is cancelled", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId(`workflow-state-row-${stateOpenId}`);

    const deleteBtns = screen.getAllByRole("button", {
      name: /workflow\.config\.states\.actions\.delete/,
    });
    fireEvent.click(deleteBtns[0]!);
    expect(
      await screen.findByTestId("workflow-delete-confirm-dialog"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workflow-delete-cancel"));

    expect(deleteWorkflowStateMock).not.toHaveBeenCalled();
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

    expect(
      await screen.findByTestId("workflow-delete-confirm-dialog"),
    ).toHaveTextContent("workflow.config.deleteConfirm.description");
    fireEvent.click(screen.getByTestId("workflow-delete-confirm"));

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

  it("requires non-empty unique options when creating a select action field", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makeDraftVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makeDraftVersion());
    createActionFormFieldMock.mockResolvedValueOnce({
      fieldType: "SELECT",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FD2",
      key: "resolution",
      label: "Resolution",
      options: ["Fixed", "Won't fix"],
      order: 0,
      required: true,
    });

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const toggle = await screen.findByRole("button", {
      name: /workflow\.config\.actions\.actions\.toggleFields/,
    });
    fireEvent.click(toggle);
    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.fields\.create/,
      }),
    );

    fireEvent.change(
      await screen.findByLabelText("workflow.config.fieldDialog.fields.label"),
      { target: { value: "Resolution" } },
    );
    fireEvent.change(
      screen.getByLabelText("workflow.config.fieldDialog.fields.key"),
      { target: { value: "resolution" } },
    );
    fireEvent.change(
      screen.getByLabelText("workflow.config.fieldDialog.fields.fieldType", {
        selector: "select",
      }),
      { target: { value: "SELECT" } },
    );

    const submit = screen.getByRole("button", {
      name: /workflow\.config\.fieldDialog\.submit/,
    });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText("workflow.config.fieldDialog.errors.optionsRequired"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("workflow.config.fieldDialog.fields.options"),
      { target: { value: "Fixed\nFixed" } },
    );
    expect(submit).toBeDisabled();
    expect(
      screen.getByText("workflow.config.fieldDialog.errors.optionsDuplicate"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("workflow.config.fieldDialog.fields.options"),
      { target: { value: "  Fixed  \n\n  Won't fix  " } },
    );
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(createActionFormFieldMock).toHaveBeenCalledWith(
        { actionId, organizationId: "ORG_01", spaceId: "SPC_01" },
        {
          fieldType: "SELECT",
          key: "resolution",
          label: "Resolution",
          options: ["Fixed", "Won't fix"],
          order: 0,
          required: false,
        },
      ),
    );
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

  it("creates a workflow binding for the current version", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      currentSpace: {
        ...sessionMock.current.currentSpace,
        role: "PM",
      },
    };
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    getWorkflowVersionMock.mockResolvedValue(makePublishedVersion());
    createWorkflowBindingMock.mockResolvedValueOnce(
      makeBinding({ workflowVersionId: publishedVersionId }),
    );

    render(<WorkflowConfigPage workflowId={workflowId} />);

    const create = await screen.findByRole("button", {
      name: /workflow\.config\.bindings\.create/,
    });
    fireEvent.click(create);

    fireEvent.change(
      screen.getByLabelText(
        "workflow.config.bindingDialog.fields.workItemType",
        {
          selector: "select",
        },
      ),
      { target: { value: "BUG" } },
    );
    fireEvent.change(
      screen.getByLabelText("workflow.config.bindingDialog.fields.priority", {
        selector: "select",
      }),
      { target: { value: "HIGH" } },
    );
    fireEvent.click(
      screen.getByLabelText("workflow.config.bindingDialog.fields.isDefault"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.bindingDialog\.submit/,
      }),
    );

    await waitFor(() =>
      expect(createWorkflowBindingMock).toHaveBeenCalledWith(
        { organizationId: "ORG_01", spaceId: "SPC_01" },
        {
          isDefault: true,
          priority: "HIGH",
          workflowId,
          workflowVersionId: publishedVersionId,
          workItemType: "BUG",
        },
      ),
    );
  });

  it("updates an existing workflow binding to the current version", async () => {
    getWorkflowMock.mockResolvedValue(makeWorkflow());
    setupVersions([makePublishedVersion()]);
    setupBindings([makeBinding({ workflowVersionId: publishedVersionId })]);
    getWorkflowVersionMock.mockResolvedValue(makePublishedVersion());
    updateWorkflowBindingMock.mockResolvedValueOnce(
      makeBinding({ priority: undefined }),
    );

    render(<WorkflowConfigPage workflowId={workflowId} />);

    await screen.findByTestId(`workflow-binding-row-${bindingId}`);
    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.bindings\.actions\.edit/,
      }),
    );

    fireEvent.change(
      screen.getByLabelText("workflow.config.bindingDialog.fields.priority", {
        selector: "select",
      }),
      { target: { value: "" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /workflow\.config\.bindingDialog\.submit/,
      }),
    );

    await waitFor(() =>
      expect(updateWorkflowBindingMock).toHaveBeenCalledWith(
        { bindingId, organizationId: "ORG_01", spaceId: "SPC_01" },
        {
          isDefault: true,
          workflowId,
          workflowVersionId: publishedVersionId,
          workItemType: "BUG",
        },
      ),
    );
  });
});
