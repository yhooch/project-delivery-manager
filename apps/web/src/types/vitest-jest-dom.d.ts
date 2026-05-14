/// <reference types="@testing-library/jest-dom" />

import type {} from "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// Re-declare jest-dom matchers on vitest's Assertion interface so that
// `.toBeInTheDocument()`, `.toHaveTextContent()` etc. typecheck in our
// component (.test.tsx) suites.
declare module "vitest" {
  interface Assertion<T = unknown>
    extends jest.Matchers<void, T>,
      TestingLibraryMatchers<unknown, void> {}
  // The asymmetric matchers helper type intentionally re-exports
  // jest-dom matchers without adding members.
  type AsymmetricMatchersContaining = TestingLibraryMatchers<unknown, void>;
}

export type { TestingLibraryMatchers };
