import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../lib/api-client";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { createOrganizationMock } = vi.hoisted(() => ({
  createOrganizationMock: vi.fn(),
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => ({ createOrganization: createOrganizationMock }),
}));

import { CreateOrganizationDialog } from "./create-organization-dialog";

beforeEach(() => {
  createOrganizationMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreateOrganizationDialog", () => {
  it("preserves the localized API error and shows backend details", async () => {
    createOrganizationMock.mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "CONFLICT",
          message: "Organization code already exists",
          requestId: "req_create_org",
        },
        new Response(null, { status: 409 }),
      ),
    );

    render(
      <CreateOrganizationDialog open={true} onOpenChange={vi.fn()} />,
    );

    fireEvent.input(screen.getByTestId("create-org-name-input"), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByTestId("create-org-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-org-error")).toHaveTextContent(
        "errors.api.CONFLICT",
      );
    });
    expect(screen.getByTestId("create-org-error")).not.toHaveTextContent(
      "errors.api.UNKNOWN",
    );
    expect(screen.getByTestId("create-org-error")).toHaveTextContent(
      "Organization code already exists",
    );
    expect(screen.getByTestId("create-org-error")).toHaveTextContent(
      "errors.apiDetails.requestId: req_create_org",
    );
  });
});
