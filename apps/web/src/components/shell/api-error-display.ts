import {
  getApiErrorMessageDetails,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";

export type ApiErrorDisplayState = {
  detailLines: string[];
  messageKey: ApiErrorMessageKey;
};

export function getApiErrorDisplay(
  error: unknown,
  requestIdLabel: string,
): ApiErrorDisplayState {
  const details = getApiErrorMessageDetails(error);

  return {
    detailLines: getApiErrorDetailLines(error, requestIdLabel),
    messageKey: details.messageKey,
  };
}

export function getApiErrorDetailLines(
  error: unknown,
  requestIdLabel: string,
): string[] {
  const errorDetails = getApiErrorMessageDetails(error);
  const lines: string[] = [];
  const seen = new Set<string>();

  const pushLine = (line: string | undefined) => {
    const normalized = line?.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    lines.push(normalized);
  };

  pushLine(errorDetails.serverMessage);
  pushLine(formatDetail("reason", errorDetails.details.reason));
  pushLine(formatDetail("field", errorDetails.details.field));

  for (const issue of errorDetails.details.issues) {
    pushLine(formatIssueSummary(issue));
  }

  for (const item of errorDetails.details.summary) {
    if (item.key === "field" || item.key === "reason" || item.key === "requestId") {
      continue;
    }
    pushLine(formatDetail(item.key, formatSummaryValue(item.value)));
  }

  const requestId = errorDetails.requestId ?? errorDetails.details.requestId;
  if (requestId) {
    pushLine(`${requestIdLabel}: ${requestId}`);
  }

  return lines;
}

export function formatApiErrorDisplayMessage(
  mainMessage: string,
  detailLines: string[],
  separator = "\n",
): string {
  return [mainMessage, ...detailLines].filter(Boolean).join(separator);
}

function formatDetail(label: string, value: string | undefined): string | undefined {
  return value ? `${label}: ${value}` : undefined;
}

function formatIssueSummary(issue: {
  code?: string;
  message?: string;
  path?: string;
}): string | undefined {
  const summary = issue.message ?? issue.code;
  if (!summary) {
    return undefined;
  }

  return issue.path ? `${issue.path}: ${summary}` : summary;
}

function formatSummaryValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}
