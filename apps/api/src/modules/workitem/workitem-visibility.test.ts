import { describe, expect, it } from "vitest";

import {
  isTesterVisibleWorkItem,
  testerVisibleWorkItemWhere,
} from "./workitem-visibility";

describe("workitem visibility", () => {
  it("keeps all bugs visible to testers", () => {
    expect(
      isTesterVisibleWorkItem({
        type: "BUG",
        statusCategory: "DONE",
        currentState: {
          code: "CLOSED",
          name: "已关闭",
        },
      }),
    ).toBe(true);
  });

  it("recognizes tester-visible task states through shared workflow semantics", () => {
    expect(
      isTesterVisibleWorkItem({
        type: "TASK",
        statusCategory: "VERIFYING",
        currentState: {
          code: "QA_VERIFY",
          name: "QA verify",
        },
      }),
    ).toBe(true);
    expect(
      isTesterVisibleWorkItem({
        type: "TASK",
        statusCategory: "WAITING",
        currentState: {
          code: "WAITING_PM_CONFIRM",
          name: "Waiting PM confirm",
        },
      }),
    ).toBe(true);
    expect(
      isTesterVisibleWorkItem({
        type: "TASK",
        statusCategory: "WAITING",
        currentState: {
          code: "PENDING_REGRESSION",
          name: "QA verify",
        },
      }),
    ).toBe(true);
    expect(
      isTesterVisibleWorkItem({
        type: "TASK",
        statusCategory: "WAITING",
        currentState: {
          code: "CUSTOM_STATE",
          name: "等待依赖",
        },
      }),
    ).toBe(false);
  });

  it("builds tester visibility query from the same state tokens", () => {
    const where = JSON.stringify(testerVisibleWorkItemWhere());

    expect(where).toContain("type");
    expect(where).toContain("BUG");
    expect(where).toContain("VERIFYING");
    expect(where).toContain("confirm");
    expect(where).toContain("pending_regression");
    expect(where).toContain("regression");
  });
});
