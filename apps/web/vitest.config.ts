import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@project-delivery/shared": resolve(
        __dirname,
        "../../packages/shared/src/index.ts",
      ),
    },
  },
  test: {
    // Use jsdom only for component (.test.tsx) tests; keep node env
    // for the existing pure-logic lib tests so we don't regress speed
    // or behaviour of the 79 existing cases.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
