import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const sessionMock = vi.hoisted(() => ({
  current: {
    session: {
      defaultOrganizationId: "ORG_01",
      defaultSpaceId: "SPC_01",
      spaces: [
        {
          id: "SPC_01",
          organizationId: "ORG_01",
          name: "Space",
          role: "PM",
        },
      ],
    },
    status: "authenticated" as const,
  },
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => sessionMock.current,
}));

const {
  archiveRequirementMock,
  getRequirementMock,
  listRequirementAssignableMembersMock,
  listRequirementVersionsMock,
  updateRequirementMock,
} = vi.hoisted(() => ({
  archiveRequirementMock: vi.fn(),
  getRequirementMock: vi.fn(),
  listRequirementAssignableMembersMock: vi.fn(),
  listRequirementVersionsMock: vi.fn(),
  updateRequirementMock: vi.fn(),
}));
vi.mock("../../lib/requirement-service", () => ({
  archiveRequirement: archiveRequirementMock,
  getRequirement: getRequirementMock,
  listRequirementAssignableMembers: listRequirementAssignableMembersMock,
  listRequirementVersions: listRequirementVersionsMock,
  updateRequirement: updateRequirementMock,
}));

const editorSlotMock = vi.hoisted(() => vi.fn());
vi.mock("./requirement-content-editor-slot", () => ({
  createContentEditorValue: () => ({
    contentJson: { type: "doc", content: [] },
    contentMarkdownCache: "",
    contentText: "",
  }),
  RequirementContentEditorSlot: (props: {
    canUploadImages?: boolean;
    disabled?: boolean;
  }) => {
    editorSlotMock(props);
    return (
      <div
        data-testid="requirement-editor-slot"
        data-can-upload-images={String(props.canUploadImages)}
        data-disabled={String(props.disabled)}
      />
    );
  },
}));

import { RequirementDetailWorkspace } from "./requirement-detail-workspace";

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
    organizationId: "ORG_01",
    spaceId: "SPC_01",
    title: "Permissioned requirement",
    summary: "Summary",
    contentJson: { type: "doc", content: [] },
    contentFormat: "TIPTAP_JSON",
    status: "DRAFT",
    priority: "MEDIUM",
    relatedWorkItems: { taskCount: 0, bugCount: 0, tasks: [], bugs: [] },
    permissions: {
      canEdit: true,
      canComment: true,
      canUploadAttachment: true,
      availableActions: [],
    },
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  } as import("@project-delivery/shared").Requirement;
}

beforeEach(() => {
  archiveRequirementMock.mockReset();
  editorSlotMock.mockClear();
  getRequirementMock.mockReset();
  listRequirementAssignableMembersMock.mockReset();
  listRequirementVersionsMock.mockReset();
  updateRequirementMock.mockReset();

  listRequirementVersionsMock.mockResolvedValue({ items: [], total: 0 });
  listRequirementAssignableMembersMock.mockResolvedValue({ items: [], total: 0 });
  updateRequirementMock.mockResolvedValue(makeRequirement());
});

afterEach(() => {
  cleanup();
});

describe("RequirementDetailWorkspace", () => {
  it("does not let a writer role override explicit canEdit=false", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({
        permissions: {
          canEdit: false,
          canComment: true,
          canUploadAttachment: true,
          availableActions: [],
        },
      }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "requirements.detail.archive" }),
    ).toBeDisabled();
    expect(screen.getByTestId("requirement-editor-slot")).toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(screen.getByTestId("requirement-editor-slot")).toHaveAttribute(
      "data-can-upload-images",
      "false",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );
    expect(updateRequirementMock).not.toHaveBeenCalled();
  });

  it("disables editing when the backend omits requirement permissions", async () => {
    getRequirementMock.mockResolvedValueOnce(
      makeRequirement({ permissions: undefined }),
    );

    render(
      <RequirementDetailWorkspace requirementId="01ARZ3NDEKTSV4RRFFQ69G5FA1" />,
    );

    expect(
      await screen.findByDisplayValue("Permissioned requirement"),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    ).toBeDisabled();
    expect(screen.getByTestId("requirement-editor-slot")).toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(screen.getByTestId("requirement-editor-slot")).toHaveAttribute(
      "data-can-upload-images",
      "false",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "requirements.detail.save" }),
    );

    expect(updateRequirementMock).not.toHaveBeenCalled();
  });
});
