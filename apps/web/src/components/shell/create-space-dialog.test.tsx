import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

const { createSpaceMock } = vi.hoisted(() => ({
  createSpaceMock: vi.fn(),
}));
vi.mock("../../lib/space-service", () => ({
  createSpace: createSpaceMock,
}));

const { refreshSessionMock } = vi.hoisted(() => ({
  refreshSessionMock: vi.fn(),
}));
vi.mock("../providers/session-provider", () => ({
  useSession: () => ({ refreshSession: refreshSessionMock }),
}));

import { CreateSpaceDialog } from "./create-space-dialog";

beforeEach(() => {
  createSpaceMock.mockReset();
  refreshSessionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreateSpaceDialog", () => {
  it("submits the create space request with trimmed optional fields and refreshes session", async () => {
    createSpaceMock.mockResolvedValueOnce({
      id: "SPC_NEW",
      organizationId: "ORG_01",
      name: "New Space",
      code: "new-space",
    });
    refreshSessionMock.mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();

    render(
      <CreateSpaceDialog
        open={true}
        onOpenChange={onOpenChange}
        organizationId="ORG_01"
      />,
    );

    fireEvent.input(screen.getByTestId("create-space-name"), {
      target: { value: "  New Space  " },
    });
    fireEvent.input(screen.getByTestId("create-space-code"), {
      target: { value: "  new-space  " },
    });
    fireEvent.input(screen.getByTestId("create-space-description"), {
      target: { value: "  Some description  " },
    });

    fireEvent.click(screen.getByTestId("create-space-submit"));

    await waitFor(() => {
      expect(createSpaceMock).toHaveBeenCalledWith("ORG_01", {
        name: "New Space",
        code: "new-space",
        description: "Some description",
      });
    });

    await waitFor(() => {
      expect(refreshSessionMock).toHaveBeenCalledWith("ORG_01", "SPC_NEW");
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("omits empty optional fields from the request payload", async () => {
    createSpaceMock.mockResolvedValueOnce({
      id: "SPC_NEW",
      organizationId: "ORG_01",
      name: "Bare",
    });
    refreshSessionMock.mockResolvedValueOnce(undefined);

    render(
      <CreateSpaceDialog
        open={true}
        onOpenChange={vi.fn()}
        organizationId="ORG_01"
      />,
    );

    fireEvent.input(screen.getByTestId("create-space-name"), {
      target: { value: "Bare" },
    });

    fireEvent.click(screen.getByTestId("create-space-submit"));

    await waitFor(() => {
      expect(createSpaceMock).toHaveBeenCalledWith("ORG_01", { name: "Bare" });
    });
  });

  it("shows a field-level local error when the code is invalid", async () => {
    render(
      <CreateSpaceDialog
        open={true}
        onOpenChange={vi.fn()}
        organizationId="ORG_01"
      />,
    );

    fireEvent.input(screen.getByTestId("create-space-name"), {
      target: { value: "New Space" },
    });
    fireEvent.input(screen.getByTestId("create-space-code"), {
      target: { value: "bad code!" },
    });
    fireEvent.click(screen.getByTestId("create-space-submit"));

    expect(screen.getByTestId("create-space-code-error")).toHaveTextContent(
      "shell.createSpace.errors.codeInvalid",
    );
    expect(createSpaceMock).not.toHaveBeenCalled();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the dialog open when createSpace rejects", async () => {
    createSpaceMock.mockRejectedValueOnce(new Error("boom"));
    const onOpenChange = vi.fn();

    render(
      <CreateSpaceDialog
        open={true}
        onOpenChange={onOpenChange}
        organizationId="ORG_01"
      />,
    );

    fireEvent.input(screen.getByTestId("create-space-name"), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByTestId("create-space-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-space-error")).toHaveTextContent(
        "errors.api.UNKNOWN",
      );
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});
