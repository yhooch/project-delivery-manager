import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const { listWorkflowsMock } = vi.hoisted(() => ({
  listWorkflowsMock: vi.fn(),
}));
vi.mock("../../lib/workflow-service", () => ({
  listWorkflows: listWorkflowsMock,
}));

// Mock the create dialog so we just observe open/mode/onSuccess.
const dialogStateMock = vi.hoisted(() => ({
  current: { open: false, mode: "" } as { open: boolean; mode: string },
}));
vi.mock("./create-workflow-dialog", () => ({
  CreateWorkflowDialog: (props: {
    open: boolean;
    mode: { kind: string };
    onClose: () => void;
    onSuccess: () => void;
  }) => {
    dialogStateMock.current = { open: props.open, mode: props.mode.kind };
    return props.open ? (
      <div data-testid="workflow-dialog-open" data-mode={props.mode.kind}>
        <button
          type="button"
          data-testid="workflow-dialog-close"
          onClick={props.onClose}
        >
          close
        </button>
        <button
          type="button"
          data-testid="workflow-dialog-success"
          onClick={props.onSuccess}
        >
          success
        </button>
      </div>
    ) : null;
  },
}));

import { WorkflowPage } from "./workflow-page";

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FW1",
    code: "BUG_DEFAULT",
    name: "Bug Default",
    description: "Default workflow for bug items",
    status: "ACTIVE",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    ...overrides,
  } as unknown as import("@project-delivery/shared").WorkflowDefinition;
}

beforeEach(() => {
  listWorkflowsMock.mockReset();
  dialogStateMock.current = { open: false, mode: "" };
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
});

describe("WorkflowPage", () => {
  it("renders workflow cards with name, code, description and status badge", async () => {
    listWorkflowsMock.mockResolvedValueOnce({
      items: [
        makeWorkflow({ name: "Story Workflow", code: "STORY_DEFAULT" }),
      ],
      total: 1,
    });

    render(<WorkflowPage />);

    await waitFor(() => expect(listWorkflowsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Story Workflow")).toBeInTheDocument();
    expect(screen.getByText("STORY_DEFAULT")).toBeInTheDocument();
    expect(
      screen.getByText("Default workflow for bug items"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workflow.definitionStatus.ACTIVE"),
    ).toBeInTheDocument();
  });

  it("renders the empty state when there are no workflows", async () => {
    listWorkflowsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<WorkflowPage />);

    await waitFor(() => expect(listWorkflowsMock).toHaveBeenCalled());
    expect(
      await screen.findByText("workflow.page.empty.title"),
    ).toBeInTheDocument();
  });

  it("renders the error state when listWorkflows rejects", async () => {
    listWorkflowsMock.mockRejectedValueOnce(new Error("boom"));

    render(<WorkflowPage />);

    // ErrorState defaults are resolved through the shared common.states keys.
    expect(
      await screen.findByRole("button", { name: "common.states.retry" }),
    ).toBeInTheDocument();
    expect(screen.getByText("common.states.errorTitle")).toBeInTheDocument();
  });

  it("shows the loading skeleton while listWorkflows is pending", async () => {
    let resolve: (value: { items: unknown[]; total: number }) => void = () => {};
    listWorkflowsMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    const { container } = render(<WorkflowPage />);

    await waitFor(() => expect(listWorkflowsMock).toHaveBeenCalled());
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );

    resolve({ items: [], total: 0 });
    await waitFor(() =>
      expect(
        screen.getByText("workflow.page.empty.title"),
      ).toBeInTheDocument(),
    );
  });

  it("opens the create dialog when 新流程 button is clicked", async () => {
    listWorkflowsMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<WorkflowPage />);

    await waitFor(() => expect(listWorkflowsMock).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: /workflow\.page\.newWorkflow/ }),
    );

    expect(
      await screen.findByTestId("workflow-dialog-open"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-dialog-open").getAttribute("data-mode"),
    ).toBe("create");
  });

  it("renders configure as an anchor link to the workflow detail page", async () => {
    listWorkflowsMock.mockResolvedValueOnce({
      items: [makeWorkflow()],
      total: 1,
    });

    render(<WorkflowPage />);

    expect(await screen.findByText("Bug Default")).toBeInTheDocument();
    const configure = screen.getByTestId(
      "workflow-card-configure-01ARZ3NDEKTSV4RRFFQ69G5FW1",
    );
    expect(configure.tagName).toBe("A");
    expect(configure.getAttribute("href")).toBe(
      "/workflow/01ARZ3NDEKTSV4RRFFQ69G5FW1",
    );
  });

  it("opens the edit dialog when 编辑 is clicked on a workflow card", async () => {
    listWorkflowsMock.mockResolvedValueOnce({
      items: [makeWorkflow()],
      total: 1,
    });

    render(<WorkflowPage />);

    expect(await screen.findByText("Bug Default")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /workflow\.page\.edit/ }),
    );

    const dialog = await screen.findByTestId("workflow-dialog-open");
    expect(dialog.getAttribute("data-mode")).toBe("edit");
  });

  it("opens the dialog in copyVersion mode when 复制为新版本 is clicked on a workflow", async () => {
    listWorkflowsMock.mockResolvedValueOnce({
      items: [makeWorkflow()],
      total: 1,
    });

    render(<WorkflowPage />);

    expect(await screen.findByText("Bug Default")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "workflow.page.copyAsNewVersion" }),
    );

    const dialog = await screen.findByTestId("workflow-dialog-open");
    expect(dialog.getAttribute("data-mode")).toBe("copyVersion");
  });

  it("renders the noSpace empty state when session has no space", async () => {
    sessionMock.current = {
      session: {
        defaultOrganizationId: "ORG_01",
        defaultSpaceId: undefined as unknown as string,
      },
      currentSpace: undefined as unknown as never,
      status: "authenticated" as const,
    };

    render(<WorkflowPage />);

    expect(
      await screen.findByText("workflow.page.noSpace.title"),
    ).toBeInTheDocument();
    expect(listWorkflowsMock).not.toHaveBeenCalled();
  });
});
