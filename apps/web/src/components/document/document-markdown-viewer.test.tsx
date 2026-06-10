// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    document.documentElement.classList.remove("dark");
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({
      svg: '<svg data-testid="rendered-mermaid-svg" role="img" viewBox="0 0 100 50"></svg>',
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

    const diagram = await screen.findByTestId("document-mermaid-diagram");

    expect(diagram).toBeVisible();
    expect(diagram).toHaveClass("cursor-zoom-in");
    expect(screen.getByTestId("rendered-mermaid-svg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "documents.markdown.mermaidPreviewOpen",
      }),
    ).toBeVisible();
    expect(
      screen.queryByTestId("document-mermaid-fullscreen-open"),
    ).not.toBeInTheDocument();
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

  it("opens rendered mermaid diagrams in a fullscreen preview with the same svg", async () => {
    render(
      <DocumentMarkdownViewer markdown={"```mermaid\ngraph TD\nA-->B\n```"} />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "documents.markdown.mermaidPreviewOpen",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "documents.markdown.mermaidPreviewTitle",
    });

    expect(dialog).toBeVisible();
    expect(screen.getAllByTestId("rendered-mermaid-svg")).toHaveLength(2);
    expect(
      within(dialog).getByTestId("rendered-mermaid-svg"),
    ).toBeInTheDocument();
  });

  it("updates mermaid fullscreen preview svg size when zooming and resetting", async () => {
    render(
      <DocumentMarkdownViewer markdown={"```mermaid\ngraph TD\nA-->B\n```"} />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "documents.markdown.mermaidPreviewOpen",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "documents.markdown.mermaidPreviewTitle",
    });
    const preview = within(dialog).getByTestId(
      "document-mermaid-preview-transform",
    );
    const viewport = within(dialog).getByTestId(
      "document-mermaid-preview-viewport",
    );

    expect(preview).toHaveStyle({
      height: "50px",
      width: "100px",
    });
    expect(preview.getAttribute("style") ?? "").not.toContain("scale(");

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "documents.markdown.mermaidZoomIn",
      }),
    );

    expect(preview).toHaveStyle({
      height: "60px",
      width: "120px",
    });
    expect(preview.getAttribute("style") ?? "").not.toContain("scale(");

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 25 },
      clientWidth: { configurable: true, value: 50 },
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(preview).toHaveStyle({
        height: "60px",
        width: "120px",
      }),
    );

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "documents.markdown.mermaidReset",
      }),
    );

    expect(preview).toHaveStyle({
      height: "25px",
      width: "50px",
    });
  });

  it("updates mermaid theme variables when the app theme changes", async () => {
    render(
      <DocumentMarkdownViewer markdown={"```mermaid\ngraph TD\nA-->B\n```"} />,
    );

    await waitFor(() =>
      expect(mermaidMock.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "base",
          themeVariables: expect.objectContaining({
            primaryColor: "#f8fafc",
            primaryTextColor: "#0f172a",
          }),
        }),
      ),
    );

    document.documentElement.classList.add("dark");

    await waitFor(() =>
      expect(mermaidMock.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "base",
          themeVariables: expect.objectContaining({
            primaryColor: "#111827",
            primaryTextColor: "#f8fafc",
          }),
        }),
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
    expect(
      screen.queryByRole("button", {
        name: "documents.markdown.mermaidPreviewOpen",
      }),
    ).not.toBeInTheDocument();
  });
});
