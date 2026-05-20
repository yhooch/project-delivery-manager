import { describe, expect, it } from "vitest";

import { formatListDate } from "./created-meta";

const t = (key: string, values?: Record<string, string | number>) => {
  switch (key) {
    case "justNow":
      return "刚刚";
    case "minutesAgo":
      return `${values?.count}分钟前`;
    case "todayAt":
      return `今天 ${values?.time}`;
    case "yesterdayAt":
      return `昨天 ${values?.time}`;
    default:
      return key;
  }
};

describe("formatListDate", () => {
  it("uses short relative copy for recent created time", () => {
    const now = new Date("2026-05-20T14:30:00");

    expect(formatListDate("2026-05-20T14:29:30", "zh-CN", t, now)).toBe(
      "刚刚",
    );
    expect(formatListDate("2026-05-20T14:22:00", "zh-CN", t, now)).toBe(
      "8分钟前",
    );
  });

  it("uses today and yesterday labels with time", () => {
    const now = new Date("2026-05-20T14:30:00");

    expect(formatListDate("2026-05-20T09:12:00", "zh-CN", t, now)).toBe(
      "今天 09:12",
    );
    expect(formatListDate("2026-05-19T09:12:00", "zh-CN", t, now)).toBe(
      "昨天 09:12",
    );
  });

  it("falls back to compact calendar dates for older items", () => {
    const now = new Date("2026-05-20T14:30:00");

    expect(formatListDate("2026-05-18T16:20:00", "zh-CN", t, now)).toBe(
      "5月18日 16:20",
    );
    expect(formatListDate("2025-12-30T16:20:00", "zh-CN", t, now)).toBe(
      "2025/12/30",
    );
  });
});
