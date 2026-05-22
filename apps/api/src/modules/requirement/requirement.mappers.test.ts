import { describe, expect, it } from "vitest";

import {
  toRequirement,
  toRequirementRelatedWorkItems,
} from "./requirement.mappers";

describe("requirement mappers", () => {
  it("maps requirement display identity when sequence is present", () => {
    expect(
      toRequirement(
        {
          authorId: null,
          contentFormat: "TIPTAP_JSON",
          contentJson: {},
          contentMarkdown: null,
          contentMarkdownCache: null,
          contentText: null,
          createdAt: new Date("2026-05-13T12:00:00.000Z"),
          id: "01H00000000000000000000010",
          organizationId: "01H00000000000000000000011",
          ownerId: null,
          priority: null,
          sequence: 9,
          spaceId: "01H00000000000000000000012",
          status: "CONFIRMED",
          summary: null,
          title: "Readable requirement",
          updatedAt: new Date("2026-05-13T12:30:00.000Z"),
          versionId: null,
        },
        [],
      ),
    ).toMatchObject({
      sequence: 9,
      displayCode: "REQ-9",
    });
  });

  it("omits requirement display identity when sequence is absent", () => {
    const requirement = toRequirement(
      {
        authorId: null,
        contentFormat: "TIPTAP_JSON",
        contentJson: {},
        contentMarkdown: null,
        contentMarkdownCache: null,
        contentText: null,
        createdAt: new Date("2026-05-13T12:00:00.000Z"),
        id: "01H00000000000000000000020",
        organizationId: "01H00000000000000000000021",
        ownerId: null,
        priority: null,
        sequence: null,
        spaceId: "01H00000000000000000000022",
        status: "DRAFT",
        summary: null,
        title: "",
        updatedAt: new Date("2026-05-13T12:30:00.000Z"),
        versionId: null,
      },
      [],
    );

    expect(requirement.sequence).toBeUndefined();
    expect(requirement.displayCode).toBeUndefined();
  });

  it("maps Markdown requirements without exposing Tiptap JSON cache fields", () => {
    expect(
      toRequirement(
        {
          authorId: null,
          contentFormat: "MARKDOWN",
          contentJson: {},
          contentMarkdown: "# Scope\n\nShip Markdown.",
          contentMarkdownCache: null,
          contentText: "Scope\n\nShip Markdown.",
          createdAt: new Date("2026-05-13T12:00:00.000Z"),
          id: "01H00000000000000000000030",
          organizationId: "01H00000000000000000000031",
          ownerId: null,
          priority: null,
          sequence: 3,
          spaceId: "01H00000000000000000000032",
          status: "CONFIRMED",
          summary: null,
          title: "Markdown requirement",
          updatedAt: new Date("2026-05-13T12:30:00.000Z"),
          versionId: null,
        },
        [],
      ),
    ).toMatchObject({
      contentFormat: "MARKDOWN",
      contentMarkdown: "# Scope\n\nShip Markdown.",
      contentText: "Scope\n\nShip Markdown.",
    });
  });

  it("groups related work items into task and bug summaries", () => {
    const related = toRequirementRelatedWorkItems([
      {
        id: "01H00000000000000000000001",
        sequence: 12,
        type: "TASK",
        title: "Implement task",
        versionId: "01H00000000000000000000002",
        assigneeId: "01H00000000000000000000003",
        statusCategory: "IN_PROGRESS",
      },
      {
        id: "01H00000000000000000000004",
        sequence: 7,
        type: "BUG",
        title: "Fix regression",
        versionId: null,
        assigneeId: null,
        statusCategory: "VERIFYING",
      },
    ]);

    expect(related).toEqual({
      taskCount: 1,
      bugCount: 1,
      tasks: [
        {
          id: "01H00000000000000000000001",
          sequence: 12,
          displayCode: "TASK-12",
          type: "TASK",
          title: "Implement task",
          versionId: "01H00000000000000000000002",
          assigneeId: "01H00000000000000000000003",
          statusCategory: "IN_PROGRESS",
        },
      ],
      bugs: [
        {
          id: "01H00000000000000000000004",
          sequence: 7,
          displayCode: "BUG-7",
          type: "BUG",
          title: "Fix regression",
          statusCategory: "VERIFYING",
        },
      ],
    });
  });
});
