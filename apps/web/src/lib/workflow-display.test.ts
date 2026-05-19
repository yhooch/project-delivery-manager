import { describe, expect, it, vi } from "vitest";

import { translateWorkflowDefinitionName } from "./workflow-display";

describe("workflow display translations", () => {
  it("falls back to custom workflow names without translating missing built-in keys", () => {
    const t = Object.assign(
      vi.fn(() => {
        throw new Error("missing translation should not be requested");
      }),
      {
        has: vi.fn(() => false),
      },
    );

    expect(
      translateWorkflowDefinitionName(t, {
        code: "CUSTOM_ACCEPTANCE",
        name: "自定义验收流程",
      }),
    ).toBe("自定义验收流程");
    expect(t.has).toHaveBeenCalledWith(
      "common.workflowDefaults.definitions.CUSTOM_ACCEPTANCE.name",
    );
    expect(t).not.toHaveBeenCalled();
  });

  it("uses built-in workflow translations when the key exists", () => {
    const t = Object.assign(vi.fn(() => "Bug 默认流程"), {
      has: vi.fn(() => true),
    });

    expect(
      translateWorkflowDefinitionName(t, {
        code: "BUG",
        name: "Bug workflow",
      }),
    ).toBe("Bug 默认流程");
    expect(t).toHaveBeenCalledWith(
      "common.workflowDefaults.definitions.BUG.name",
    );
  });
});
