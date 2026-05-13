import { test } from "@playwright/test";

import { e2eEnv, probeApi, probeWeb } from "./m0-env";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function buildM4RunId(): string {
  return `m4_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(0, 28);
}

export async function skipWhenM4EnvironmentUnavailable(): Promise<void> {
  const reason = await resolveM4EnvironmentSkipReason();

  test.skip(Boolean(reason), reason);
}

async function resolveM4EnvironmentSkipReason(): Promise<string | undefined> {
  if (!readBoolean(process.env.E2E_M4_ENABLED)) {
    return "M4 E2E 默认跳过；设置 E2E_M4_ENABLED=1 后才会执行 MVP 自动化主链路。";
  }

  if (!e2eEnv.dbReady) {
    return "M4 E2E 需要已迁移的可丢弃测试数据库；确认 API 使用测试库后设置 E2E_DB_READY=1。";
  }

  const apiProbe = await probeApi();
  if (!apiProbe.ok) {
    return apiProbe.reason?.replaceAll("M0 E2E", "M4 E2E");
  }

  if (e2eEnv.requireWeb) {
    const webProbe = await probeWeb();
    if (!webProbe.ok) {
      return webProbe.reason?.replaceAll("M0 E2E", "M4 E2E");
    }
  }

  return undefined;
}

function readBoolean(value: string | undefined): boolean {
  return TRUE_VALUES.has(value?.toLowerCase() ?? "");
}
