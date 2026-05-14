import {
  expect,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

type NetworkIssueCollectorOptions = {
  ignoreConsole?: (message: ConsoleMessage) => boolean;
  ignoreStatus?: (response: Response) => boolean;
  ignoreRequestFailure?: (request: Request) => boolean;
  observeResponse?: (response: Response) => void;
};

export type NetworkIssueCollector = {
  assertNoIssues: () => void;
  dispose: () => void;
  issues: string[];
};

export function collectUnexpectedNetworkIssues(
  page: Page,
  options: NetworkIssueCollectorOptions = {},
): NetworkIssueCollector {
  const issues: string[] = [];

  const onResponse = (response: Response) => {
    options.observeResponse?.(response);

    const status = response.status();
    if (status < 400 || options.ignoreStatus?.(response)) {
      return;
    }

    issues.push(
      `${response.request().method()} ${response.url()} -> ${status} ${response.statusText()}`,
    );
  };

  const onRequestFailed = (request: Request) => {
    if (options.ignoreRequestFailure?.(request)) {
      return;
    }

    issues.push(
      `${request.method()} ${request.url()} failed: ${
        request.failure()?.errorText ?? "unknown error"
      }`,
    );
  };

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }

    if (options.ignoreConsole?.(message)) {
      return;
    }

    issues.push(`console.${message.type()}: ${message.text()}`);
  };

  const onPageError = (error: Error) => {
    issues.push(`pageerror: ${error.message}`);
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    assertNoIssues: () => {
      expect(issues, "Unexpected UI runtime issues").toEqual([]);
    },
    dispose: () => {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
    issues,
  };
}
