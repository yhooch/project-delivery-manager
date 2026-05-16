import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { addSpaceMemberMock, listOrganizationMembersMock } = vi.hoisted(() => ({
  addSpaceMemberMock: vi.fn(),
  listOrganizationMembersMock: vi.fn(),
}));

vi.mock("../../lib/space-service", () => ({
  addSpaceMember: addSpaceMemberMock,
  listOrganizationMembers: listOrganizationMembersMock,
}));

import type { OrganizationMemberWithUser } from "@project-delivery/shared";

import { AddSpaceMemberDialog } from "./add-space-member-dialog";

beforeEach(() => {
  addSpaceMemberMock.mockReset();
  listOrganizationMembersMock.mockReset();
  listOrganizationMembersMock.mockResolvedValue({
    items: [
      makeOrganizationMember({
        id: "ORG_MEMBER_01",
        name: "Alice Adams",
        userId: "USER_01",
        username: "alice",
      }),
      makeOrganizationMember({
        id: "ORG_MEMBER_02",
        name: "Bob Baker",
        userId: "USER_02",
        username: "bob",
      }),
    ],
    total: 2,
  });
});

afterEach(() => {
  cleanup();
});

describe("AddSpaceMemberDialog", () => {
  it("uses listbox options instead of nested buttons and supports keyboard selection", async () => {
    render(
      <AddSpaceMemberDialog
        existingUserIds={new Set()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        open={true}
        organizationId="ORG_01"
        spaceId="SPC_01"
      />,
    );

    const listbox = await screen.findByRole("listbox", {
      name: "spaceSettings.dialog.addMember.fields.username",
    });
    const options = within(listbox).getAllByRole("option");

    expect(options[0].tagName).toBe("DIV");
    expect(
      within(listbox).queryByRole("button", { name: /Alice Adams/ }),
    ).not.toBeInTheDocument();

    options[0].focus();
    expect(options[0]).toHaveFocus();

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();

    fireEvent.keyDown(options[1], { key: "Enter" });

    await waitFor(() =>
      expect(options[1]).toHaveAttribute("aria-selected", "true"),
    );
    expect(
      screen.getByRole("textbox", {
        name: "spaceSettings.dialog.addMember.fields.username",
      }),
    ).toHaveValue("bob");
  });
});

function makeOrganizationMember({
  id,
  name,
  userId,
  username,
}: {
  id: string;
  name: string;
  userId: string;
  username: string;
}): OrganizationMemberWithUser {
  return {
    id,
    organizationId: "ORG_01",
    role: "MEMBER",
    status: "ACTIVE",
    user: {
      id: userId,
      name,
      username,
    },
    userId,
  } as OrganizationMemberWithUser;
}
