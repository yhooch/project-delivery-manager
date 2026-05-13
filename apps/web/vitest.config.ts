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
});
