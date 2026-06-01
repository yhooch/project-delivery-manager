// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentMarkdownViewer } from "./document-markdown-viewer";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    `${namespace ? `${namespace}.` : ""}${key}`,
}));

vi.mock("../../i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("DocumentMarkdownViewer", () => {
  it("renders standalone attachment images as readable blocks", () => {
    render(
      <DocumentMarkdownViewer markdown="![Diagram](/api/v1/attachments/01H00000000000000000000001/download)" />,
    );

    const image = screen.getByRole("img", { name: "Diagram" });

    expect(image).toHaveAttribute(
      "src",
      "/api/v1/attachments/01H00000000000000000000001/download",
    );
    expect(image).toHaveClass("max-h-[70vh]");
  });

  it("renders attachment images inside text as inline icons", () => {
    render(
      <DocumentMarkdownViewer markdown="- 一键派发![](/api/v1/attachments/01H00000000000000000000001/download)" />,
    );

    const image = screen.getByRole("img", {
      name: "documents.markdown.image",
    });

    expect(image).toHaveClass("inline-block", "max-h-6");
  });

  it("keeps remote images as explicit links", () => {
    render(
      <DocumentMarkdownViewer markdown="![Remote](https://example.com/a.png)" />,
    );

    expect(
      screen.queryByRole("img", { name: "Remote" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("documents.markdown.remoteImage")).toBeVisible();
  });
});
