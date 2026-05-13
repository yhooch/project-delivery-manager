import {
  SpaceExceptionsViewQuerySchema,
  SpaceOverviewViewQuerySchema,
  StatusCategorySchema,
  VersionBoardViewQuerySchema,
  ViewExceptionTypeSchema,
  WorkbenchViewQuerySchema,
  WorkItemTypeSchema,
  type SpaceExceptionsViewQuery,
  type SpaceOverviewViewQuery,
  type StatusCategory,
  type VersionBoardViewQuery,
  type ViewExceptionType,
  type WorkbenchViewQuery,
  type WorkItemType,
} from "@project-delivery/shared";
import { z } from "zod";

export type M4ViewKind =
  | "my-workbench"
  | "space-overview"
  | "version-board"
  | "space-exceptions";

export type M4ViewFilterControlId =
  | "assigneeId"
  | "exceptionType"
  | "statusCategory"
  | "versionId"
  | "workItemType";

export type M4ViewFilterOption<TValue extends string = string> = {
  labelKey: string;
  value: TValue;
};

export type M4ViewFilterControlModel = {
  allLabelKey?: string;
  id: M4ViewFilterControlId;
  labelKey: string;
  options?: readonly M4ViewFilterOption[];
  valueKind: "entity" | "enum";
  views: readonly M4ViewKind[];
};

export const M4_STATUS_CATEGORY_OPTIONS = StatusCategorySchema.options.map(
  (value) => ({
    labelKey: `m4Views.statusCategory.${value}`,
    value,
  }),
) satisfies readonly M4ViewFilterOption<StatusCategory>[];

export const M4_WORK_ITEM_TYPE_OPTIONS = WorkItemTypeSchema.options.map(
  (value) => ({
    labelKey: `m4Views.workItemType.${value}`,
    value,
  }),
) satisfies readonly M4ViewFilterOption<WorkItemType>[];

export const M4_EXCEPTION_TYPE_OPTIONS = ViewExceptionTypeSchema.options.map(
  (value) => ({
    labelKey: `m4Views.exceptionType.${value}`,
    value,
  }),
) satisfies readonly M4ViewFilterOption<ViewExceptionType>[];

export const M4_VIEW_FILTER_CONTROLS = [
  {
    allLabelKey: "m4Views.filters.allVersions",
    id: "versionId",
    labelKey: "m4Views.filters.version",
    valueKind: "entity",
    views: ["my-workbench", "space-overview", "space-exceptions"],
  },
  {
    allLabelKey: "m4Views.filters.allAssignees",
    id: "assigneeId",
    labelKey: "m4Views.filters.assignee",
    valueKind: "entity",
    views: ["my-workbench", "version-board", "space-exceptions"],
  },
  {
    allLabelKey: "m4Views.filters.allStatusCategories",
    id: "statusCategory",
    labelKey: "m4Views.filters.statusCategory",
    options: M4_STATUS_CATEGORY_OPTIONS,
    valueKind: "enum",
    views: ["my-workbench", "version-board", "space-exceptions"],
  },
  {
    allLabelKey: "m4Views.filters.allWorkItemTypes",
    id: "workItemType",
    labelKey: "m4Views.filters.workItemType",
    options: M4_WORK_ITEM_TYPE_OPTIONS,
    valueKind: "enum",
    views: ["my-workbench", "version-board", "space-exceptions"],
  },
  {
    allLabelKey: "m4Views.filters.allExceptionTypes",
    id: "exceptionType",
    labelKey: "m4Views.filters.exceptionType",
    options: M4_EXCEPTION_TYPE_OPTIONS,
    valueKind: "enum",
    views: ["my-workbench", "space-exceptions"],
  },
] as const satisfies readonly M4ViewFilterControlModel[];

const optionalText = z.preprocess(
  (value) => normalizeOptionalText(value),
  z.string().optional(),
);

const optionalStatusCategory = z.preprocess(
  (value) => normalizeOptionalText(value),
  StatusCategorySchema.optional(),
);

const optionalWorkItemType = z.preprocess(
  (value) => normalizeOptionalText(value),
  WorkItemTypeSchema.optional(),
);

const optionalExceptionType = z.preprocess(
  (value) => normalizeOptionalText(value),
  ViewExceptionTypeSchema.optional(),
);

export const m4ViewFilterFormSchema = z
  .object({
    assigneeId: optionalText,
    exceptionType: optionalExceptionType,
    organizationId: optionalText,
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
    sortBy: optionalText,
    sortOrder: z.preprocess(
      (value) => normalizeOptionalText(value),
      z.enum(["asc", "desc"]).optional(),
    ),
    spaceId: optionalText,
    statusCategory: optionalStatusCategory,
    versionId: optionalText,
    workItemType: optionalWorkItemType,
  })
  .strict();

export type M4ViewFilterFormInput = z.input<typeof m4ViewFilterFormSchema>;
export type M4ViewFilterFormValues = z.output<typeof m4ViewFilterFormSchema>;

export function getM4ViewFilterControls(view: M4ViewKind) {
  return M4_VIEW_FILTER_CONTROLS.filter((control) =>
    (control.views as readonly M4ViewKind[]).includes(view),
  );
}

export function toWorkbenchViewQuery(
  input: M4ViewFilterFormInput,
): WorkbenchViewQuery {
  return WorkbenchViewQuerySchema.parse(m4ViewFilterFormSchema.parse(input));
}

export function toSpaceOverviewViewQuery(
  input: Pick<M4ViewFilterFormInput, "organizationId" | "versionId">,
): SpaceOverviewViewQuery {
  return SpaceOverviewViewQuerySchema.parse(
    m4ViewFilterFormSchema.pick({
      organizationId: true,
      versionId: true,
    }).parse(input),
  );
}

export function toVersionBoardViewQuery(
  input: Omit<M4ViewFilterFormInput, "exceptionType" | "versionId">,
): VersionBoardViewQuery {
  const values = m4ViewFilterFormSchema
    .omit({ exceptionType: true, versionId: true })
    .parse(input);

  return VersionBoardViewQuerySchema.parse(values);
}

export function toSpaceExceptionsViewQuery(
  input: Omit<M4ViewFilterFormInput, "spaceId">,
): SpaceExceptionsViewQuery {
  const values = m4ViewFilterFormSchema.omit({ spaceId: true }).parse(input);

  return SpaceExceptionsViewQuerySchema.parse(values);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed === "ALL") {
    return undefined;
  }

  return trimmed;
}
