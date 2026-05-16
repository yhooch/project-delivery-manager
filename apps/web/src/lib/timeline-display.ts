import type { TimelineEventType } from "@project-delivery/shared";

type TimelineEventLabelTranslator = (key: TimelineEventType) => string;

export function getTimelineEventLabel(
  eventType: TimelineEventType,
  translate: TimelineEventLabelTranslator,
): string {
  try {
    return translate(eventType);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      throw error;
    }
    return eventType;
  }
}
