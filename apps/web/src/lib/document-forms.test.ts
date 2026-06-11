import { describe, expect, it } from "vitest";

import { createDocumentEditForm, getImportKind } from "./document-forms";
import type { DocumentDetail } from "./document-service";

function createDocumentDetail(
  patch: Partial<DocumentDetail> = {},
): DocumentDetail {
  return {
    contentFormat: "MARKDOWN",
    contentMarkdown: "# Plan",
    createdAt: "2026-05-27T10:00:00.000Z",
    id: "DOC_01",
    kind: "GENERAL",
    lastEditedAt: "2026-05-27T11:00:00.000Z",
    lastEditedVia: "USER",
    organizationId: "ORG_01",
    revision: 3,
    sourceType: "UPLOAD_MARKDOWN",
    spaceId: "SPC_01",
    status: "ACTIVE",
    title: "Plan",
    updatedAt: "2026-05-27T11:00:00.000Z",
    ...patch,
  };
}

describe("document forms", () => {
  it("detects supported import file kinds", () => {
    expect(getImportKind(new File(["# Plan"], "plan.md"))).toBe("markdown");
    expect(getImportKind(new File(["# Plan"], "plan.markdown"))).toBe(
      "markdown",
    );
    expect(getImportKind(new File(["docx"], "plan.docx"))).toBe("docx");
    expect(getImportKind(new File(["<h1>Plan</h1>"], "plan.html"))).toBe(
      "html",
    );
    expect(getImportKind(new File(["<h1>Plan</h1>"], "plan.htm"))).toBe("html");
    expect(getImportKind(new File(["zip"], "html-assets.zip"))).toBe("html");
    expect(getImportKind(new File(["csv"], "plan.csv"))).toBeNull();
  });

  it("keeps requirement document links in resource codes", () => {
    const form = createDocumentEditForm(
      createDocumentDetail({
        links: [
          {
            displayCode: "REQ-12",
            id: "LNK_REQ",
            targetId: "REQ_01",
            targetType: "DOCUMENT",
            title: "Requirement",
          },
          {
            id: "LNK_DOC",
            targetId: "DOC_02",
            targetType: "DOCUMENT",
            title: "Related document",
          },
          {
            displayCode: "TASK-42",
            id: "LNK_TASK",
            targetId: "TASK_42",
            targetType: "WORK_ITEM",
            title: "Task",
          },
        ],
      }),
    );

    expect(form.linkedDocuments).toEqual([
      expect.objectContaining({
        targetId: "DOC_02",
        targetType: "DOCUMENT",
      }),
    ]);
    expect(form.linkedResourceCodes).toBe("REQ-12, TASK-42");
  });
});
