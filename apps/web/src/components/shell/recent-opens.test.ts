// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecentStorageKey,
  readRecent,
  recordRecentOpen,
  writeRecent,
} from "./recent-opens";

const scope = { organizationId: "ORG_01", spaceId: "SPC_01" };
const storageKey = createRecentStorageKey(scope);

beforeEach(() => {
  window.localStorage.clear();
});

describe("recent opens", () => {
  it("writes the displayCode and space context without the legacy code field", () => {
    writeRecent(
      {
        id: "TASK_01",
        type: "TASK",
        displayCode: "TASK-42",
        title: "Implement lookup",
        href: "/work-items?workItemId=TASK_01",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      },
      scope,
    );

    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "[]",
    ) as Array<Record<string, unknown>>;

    expect(stored[0]).toMatchObject({
      id: "TASK_01",
      type: "TASK",
      displayCode: "TASK-42",
      title: "Implement lookup",
      href: "/work-items?workItemId=TASK_01",
      organizationId: "ORG_01",
      spaceId: "SPC_01",
    });
    expect(stored[0]).not.toHaveProperty("code");
  });

  it("reads legacy code entries as displayCode", () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "TASK_01",
          type: "TASK",
          code: "TASK-OLD",
          title: "Legacy task",
          href: "/work-items",
        },
      ]),
    );

    expect(readRecent(scope)[0]).toMatchObject({
      id: "TASK_01",
      type: "TASK",
      displayCode: "TASK-OLD",
      title: "Legacy task",
      href: "/work-items",
    });
  });

  it("dispatches scoped recent change events when recording an open", () => {
    const listener = vi.fn();
    window.addEventListener("pdm:command-palette:recent-changed", listener);

    recordRecentOpen(
      {
        id: "REQ_01",
        type: "REQUIREMENT",
        displayCode: "REQ-7",
        title: "Requirement",
        href: "/requirements/REQ_01",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      },
      scope,
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      detail: { storageKey },
    });

    window.removeEventListener("pdm:command-palette:recent-changed", listener);
  });

  it("persists document entries without requiring a DOC display code", () => {
    recordRecentOpen(
      {
        id: "DOC_01",
        type: "DOCUMENT",
        displayCode: "Document",
        title: "Launch plan",
        href: "/documents/DOC_01",
        organizationId: "ORG_01",
        spaceId: "SPC_01",
      },
      scope,
    );

    expect(readRecent(scope)[0]).toMatchObject({
      id: "DOC_01",
      type: "DOCUMENT",
      displayCode: "Document",
      title: "Launch plan",
      href: "/documents/DOC_01",
    });
  });
});
