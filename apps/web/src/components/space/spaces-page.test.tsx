import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { translatorCache } = vi.hoisted(() => ({
  translatorCache: new Map<
    string,
    (key: string, vars?: Record<string, unknown>) => string
  >(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const key = namespace ?? "__root__";
    let fn = translatorCache.get(key);
    if (!fn) {
      fn = (k: string, vars?: Record<string, unknown>) => {
        const base = namespace ? `${namespace}.${k}` : k;
        if (!vars) return base;
        const suffix = Object.entries(vars)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(",");
        return `${base}(${suffix})`;
      };
      translatorCache.set(key, fn);
    }
    return fn;
  },
}));

const switchSpaceMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPC-A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [
      {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        code: "SPC-A",
        role: "SPACE_ADMIN",
        status: "ACTIVE",
      },
      {
        id: "SPC_02",
        organizationId: "ORG_01",
        name: "Space B",
        code: "SPC-B",
        role: "PM",
        status: "ACTIVE",
      },
    ],
    status: "authenticated" as const,
    switchSpace: switchSpaceMock,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const { listSpacesMock } = vi.hoisted(() => ({
  listSpacesMock: vi.fn(),
}));
vi.mock("../../lib/space-service", async () => {
  const actual = await vi.importActual<typeof import("../../lib/space-service")>(
    "../../lib/space-service",
  );
  return {
    ...actual,
    listSpaces: listSpacesMock,
  };
});

vi.mock("../shell/create-space-dialog", () => ({
  CreateSpaceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-space-dialog-open" /> : null,
}));

import { SpacesPage } from "./spaces-page";

function makeSpace(overrides: Record<string, unknown> = {}) {
  return {
    id: "SPC_01",
    organizationId: "ORG_01",
    name: "Space A",
    code: "SPC-A",
    description: "Delivery space",
    ownerId: undefined,
    status: "ACTIVE",
    ...overrides,
  } as unknown as import("@project-delivery/shared").SpaceSummary;
}

beforeEach(() => {
  listSpacesMock.mockReset();
  switchSpaceMock.mockReset();
  sessionMock.current = {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      capabilities: {
        canCreateOrganization: true,
        canCreateSpace: true,
      },
    },
    currentOrganization: {
      id: "ORG_01",
      name: "Acme Corp",
      code: "ACME",
      role: "OWNER",
      status: "ACTIVE",
    },
    currentSpace: {
      id: "SPC_01",
      organizationId: "ORG_01",
      name: "Space A",
      code: "SPC-A",
      role: "SPACE_ADMIN",
      status: "ACTIVE",
    },
    spacesForCurrentOrganization: [
      {
        id: "SPC_01",
        organizationId: "ORG_01",
        name: "Space A",
        code: "SPC-A",
        role: "SPACE_ADMIN",
        status: "ACTIVE",
      },
      {
        id: "SPC_02",
        organizationId: "ORG_01",
        name: "Space B",
        code: "SPC-B",
        role: "PM",
        status: "ACTIVE",
      },
    ],
    status: "authenticated" as const,
    switchSpace: switchSpaceMock,
  };
});

afterEach(() => {
  cleanup();
});

describe("SpacesPage", () => {
  it("lists organization spaces and switches to another joined space", async () => {
    listSpacesMock.mockResolvedValueOnce({
      items: [
        makeSpace(),
        makeSpace({ id: "SPC_02", name: "Space B", code: "SPC-B" }),
      ],
      total: 2,
    });
    switchSpaceMock.mockResolvedValueOnce(undefined);

    render(<SpacesPage />);

    await waitFor(() => expect(listSpacesMock).toHaveBeenCalledWith("ORG_01"));
    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(screen.getByText("Space B")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-create-button")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-switch-SPC_01")).toBeDisabled();

    fireEvent.click(screen.getByTestId("spaces-switch-SPC_02"));

    await waitFor(() => expect(switchSpaceMock).toHaveBeenCalledWith("SPC_02"));
  });

  it("renders read-only copy and no create action for non-admin organization roles", async () => {
    sessionMock.current = {
      ...sessionMock.current,
      session: {
        ...sessionMock.current.session,
        capabilities: {
          canCreateOrganization: true,
          canCreateSpace: false,
        },
      },
      currentOrganization: {
        ...sessionMock.current.currentOrganization,
        role: "MEMBER",
      },
    };
    listSpacesMock.mockResolvedValueOnce({
      items: [makeSpace()],
      total: 1,
    });

    render(<SpacesPage />);

    expect(await screen.findByText("Space A")).toBeInTheDocument();
    expect(screen.getByTestId("spaces-readonly-notice")).toHaveTextContent(
      "spaces.list.readOnly",
    );
    expect(screen.queryByTestId("spaces-create-button")).not.toBeInTheDocument();
  });

  it("renders an empty state when the organization has no spaces", async () => {
    listSpacesMock.mockResolvedValueOnce({ items: [], total: 0 });

    render(<SpacesPage />);

    expect(await screen.findByText("spaces.list.empty")).toBeInTheDocument();
  });
});
