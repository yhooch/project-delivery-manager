export type WorkItemDetailPanel =
  | "attachments"
  | "comments"
  | "detail"
  | "timeline";

export function normalizeWorkItemDetailPanel(
  value: string | null | undefined,
): WorkItemDetailPanel | undefined {
  const normalized = value?.trim();
  return normalized === "attachments" ||
    normalized === "comments" ||
    normalized === "detail" ||
    normalized === "timeline"
    ? normalized
    : undefined;
}
