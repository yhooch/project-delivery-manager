// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentMarkdownViewer } from "./document-markdown-viewer";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    `${namespace ? `${namespace}.` : ""}${key}`,
}));

vi.mock("../../i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

describe("DocumentMarkdownViewer", () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({
      svg: '<svg data-testid="rendered-mermaid-svg" role="img"></svg>',
    });
  });

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

  it("renders mermaid code fences as diagrams", async () => {
    render(
      <DocumentMarkdownViewer markdown={"```mermaid\ngraph TD\nA-->B\n```"} />,
    );

    expect(await screen.findByTestId("document-mermaid-diagram")).toBeVisible();
    expect(screen.getByTestId("rendered-mermaid-svg")).toBeInTheDocument();
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
      }),
    );
    await waitFor(() =>
      expect(mermaidMock.render).toHaveBeenCalledWith(
        expect.stringMatching(/^document-mermaid-/u),
        "graph TD\nA-->B",
      ),
    );
  });

  it("falls back to source when mermaid rendering fails", async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error("Invalid diagram"));

    render(
      <DocumentMarkdownViewer markdown={"```mermaid\ngraph TD\nA-->\n```"} />,
    );

    const fallback = await screen.findByTestId("document-mermaid-fallback");

    expect(fallback).toHaveTextContent("documents.markdown.mermaidError");
    expect(fallback).toHaveTextContent("graph TD");
    expect(fallback).toHaveTextContent("A-->");
  });
});
