import type { Logger } from "@nestjs/common";

export type StructuredLogLevel = "error" | "log" | "warn";
export type StructuredLogPayload = Record<
  string,
  boolean | number | string | string[] | undefined
>;

export type StructuredLogEntry = {
  level: StructuredLogLevel;
  payload: StructuredLogPayload;
};

export function writeStructuredLog(
  logger: Pick<Logger, "error" | "log" | "warn">,
  entry: StructuredLogEntry,
): void {
  const line = JSON.stringify(entry.payload);

  switch (entry.level) {
    case "error":
      logger.error(line);
      return;
    case "warn":
      logger.warn(line);
      return;
    default:
      logger.log(line);
  }
}
