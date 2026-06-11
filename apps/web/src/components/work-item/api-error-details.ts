import { getApiErrorDetailLines as getShellApiErrorDetailLines } from "../shell/api-error-display";

type ApiErrorDetailLinesOptions = {
  requestIdLabel: string;
};

export function getApiErrorDetailLines(
  error: unknown,
  { requestIdLabel }: ApiErrorDetailLinesOptions,
): string[] {
  return getShellApiErrorDetailLines(error, requestIdLabel);
}
