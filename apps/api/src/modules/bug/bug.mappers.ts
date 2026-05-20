import type {
  BugDetail,
  BugSeverity,
  BugView,
  PermissionSnapshot,
  TagDto,
} from "@project-delivery/shared";

import { toWorkItem } from "../workitem/workitem.mappers";

type PrismaBugDetailRecord = {
  workItemId: string;
  severity: BugSeverity;
  stepsToReproduce: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  fixNote: string | null;
  regressionResult: string | null;
  regressionById: string | null;
  regressionAt: Date | null;
  relatedTaskId: string | null;
};

export type PrismaBugViewRecord = Parameters<typeof toWorkItem>[0] & {
  bugDetail: PrismaBugDetailRecord;
};

export function toBugView(
  record: PrismaBugViewRecord,
  permissions?: PermissionSnapshot,
  tags: TagDto[] = [],
): BugView {
  return {
    ...toWorkItem(record, permissions, tags),
    type: "BUG",
    bugDetail: toBugDetail(record.bugDetail),
  };
}

function toBugDetail(record: PrismaBugDetailRecord): BugDetail {
  return {
    workItemId: record.workItemId,
    severity: record.severity,
    stepsToReproduce: record.stepsToReproduce ?? undefined,
    expectedResult: record.expectedResult ?? undefined,
    actualResult: record.actualResult ?? undefined,
    fixNote: record.fixNote ?? undefined,
    regressionResult: record.regressionResult ?? undefined,
    regressionBy: record.regressionById ?? undefined,
    regressionAt: record.regressionAt?.toISOString(),
    relatedTaskId: record.relatedTaskId ?? undefined,
  };
}
