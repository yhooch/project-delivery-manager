import { test } from "@playwright/test";

import { e2eEnv, probeApi, probeWeb } from "./m0-env";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export async function skipWhenUiEnvironmentUnavailable(): Promise<void> {
  const reason = await resolveUiEnvironmentSkipReason();
  test.skip(Boolean(reason), reason);
}

async function resolveUiEnvironmentSkipReason(): Promise<string | undefined> {
  if (!readBoolean(process.env.E2E_UI_ENABLED)) {
    return "UI E2E 默认跳过；设置 E2E_UI_ENABLED=1 后才会执行浏览器主链路。";
  }

  if (!e2eEnv.dbReady) {
    return "UI E2E 需要已迁移的可丢弃测试数据库；确认 API 使用测试库后设置 E2E_DB_READY=1。";
  }

  const apiProbe = await probeApi();
  if (!apiProbe.ok) {
    return apiProbe.reason?.replaceAll("M0 E2E", "UI E2E");
  }

  const webProbe = await probeWeb();
  if (!webProbe.ok) {
    return webProbe.reason?.replaceAll("M0 E2E", "UI E2E");
  }

  return undefined;
}

function readBoolean(value: string | undefined): boolean {
  return TRUE_VALUES.has(value?.toLowerCase() ?? "");
}

export function buildUiRunId(): string {
  return `ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
