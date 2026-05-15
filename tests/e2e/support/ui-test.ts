import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

import { e2eEnv } from "./m0-env";
import {
  collectUnexpectedNetworkIssues,
  type NetworkIssueCollector,
} from "./ui-network-assertions";

type UiFixtures = {
  networkIssues: NetworkIssueCollector;
};

export const test = base.extend<UiFixtures>({
  networkIssues: [
    async ({ page }, use) => {
      let hasAuthenticatedSession = false;
      const collector = collectUnexpectedNetworkIssues(page, {
        ignoreConsole: (message) =>
          ignoreConsole(message, hasAuthenticatedSession),
        ignoreStatus: (response) =>
          ignoreStatus(response, hasAuthenticatedSession),
        ignoreRequestFailure,
        observeResponse: (response) => {
          if (isSuccessfulAuthenticationResponse(response)) {
            hasAuthenticatedSession = true;
          }
        },
      });

      await use(collector);

      collector.dispose();
      collector.assertNoIssues();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Request, Response };

function ignoreStatus(
  response: Response,
  hasAuthenticatedSession: boolean,
): boolean {
  const url = response.url();
  if (!url.startsWith(e2eEnv.webBaseURL)) {
    return true;
  }

  const parsed = new URL(url);
  const pathname = parsed.pathname;
  const method = response.request().method();

  if (isBrowserMetadataRequest(pathname) || isSourceMapRequest(pathname)) {
    return true;
  }

  return (
    !hasAuthenticatedSession &&
    method === "GET" &&
    response.status() === 401 &&
    pathname === "/api/v1/auth/session"
  );
}

function isSuccessfulAuthenticationResponse(response: Response): boolean {
  const status = response.status();
  if (status < 200 || status >= 400) {
    return false;
  }

  const url = response.url();
  if (!url.startsWith(e2eEnv.webBaseURL)) {
    return false;
  }

  const pathname = new URL(url).pathname;
  const method = response.request().method();

  return (
    (method === "GET" && pathname === "/api/v1/auth/session") ||
    (method === "POST" &&
      (pathname === "/api/v1/auth/register" ||
        pathname === "/api/v1/auth/login"))
  );
}

function ignoreRequestFailure(request: Request): boolean {
  const url = request.url();
  if (!url.startsWith(e2eEnv.webBaseURL)) {
    return true;
  }

  const pathname = new URL(url).pathname;

  return isBrowserMetadataRequest(pathname) || isSourceMapRequest(pathname);
}

function ignoreConsole(
  message: ConsoleMessage,
  hasAuthenticatedSession: boolean,
): boolean {
  const text = message.text();

  return (
    text.includes("was preloaded using link preload") ||
    (!hasAuthenticatedSession &&
      text.includes("Failed to load resource") &&
      text.includes("401")) ||
    (text.includes("Failed to load resource") &&
      (text.includes("/favicon.ico") || text.includes(".map"))
    )
  );
}

function isBrowserMetadataRequest(pathname: string): boolean {
  return (
    pathname === "/favicon.ico" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/apple-touch-icon-precomposed.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/site.webmanifest"
  );
}

function isSourceMapRequest(pathname: string): boolean {
  return !pathname.startsWith("/api/") && pathname.endsWith(".map");
}
