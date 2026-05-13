import type {
  ActionFormFieldType,
  DefaultWorkflowCode,
  SpaceRole,
  StatusCategory,
  WorkflowActorRelation,
  WorkItemType,
} from "@project-delivery/shared";

export type DefaultWorkflowStateTemplate = {
  readonly code: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly isStart?: boolean;
  readonly isEnd?: boolean;
};

export type DefaultWorkflowActionFormFieldTemplate = {
  readonly key: string;
  readonly label: string;
  readonly fieldType: ActionFormFieldType;
  readonly required: boolean;
  readonly options?: readonly string[];
};

export type DefaultWorkflowActionTemplate = {
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly allowedSpaceRoles: readonly SpaceRole[];
  readonly actorRelations: readonly WorkflowActorRelation[];
  readonly requiresComment?: boolean;
  readonly formFields?: readonly DefaultWorkflowActionFormFieldTemplate[];
};

export type DefaultWorkflowTemplate = {
  readonly code: DefaultWorkflowCode;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly binding: {
    readonly workItemType: WorkItemType;
    readonly isDefault: boolean;
  };
  readonly states: readonly DefaultWorkflowStateTemplate[];
  readonly actions: readonly DefaultWorkflowActionTemplate[];
};

const taskAssigneeRoles = ["PM", "SPACE_ADMIN"] as const;
const testingRoles = ["TESTER", "PM", "SPACE_ADMIN"] as const;
const managerRoles = ["PM", "SPACE_ADMIN"] as const;
const bugFixRoles = ["DEVELOPER", "PM", "SPACE_ADMIN"] as const;
const assigneeRelation = ["ASSIGNEE"] as const;

export const DEFAULT_WORKFLOW_TEMPLATES: readonly DefaultWorkflowTemplate[] = [
  {
    code: "DEVELOPMENT_TASK",
    name: "开发任务默认流程",
    description: "系统内置开发任务流程，用于开发、提测和测试闭环。",
    version: 1,
    binding: {
      workItemType: "TASK",
      isDefault: false,
    },
    states: [
      {
        code: "PENDING",
        name: "待处理",
        category: "NOT_STARTED",
        isStart: true,
      },
      {
        code: "IN_PROGRESS",
        name: "处理中",
        category: "IN_PROGRESS",
      },
      {
        code: "BLOCKED",
        name: "阻塞中",
        category: "WAITING",
      },
      {
        code: "READY_FOR_TEST",
        name: "待提测",
        category: "WAITING",
      },
      {
        code: "TESTING",
        name: "测试中",
        category: "VERIFYING",
      },
      {
        code: "DONE",
        name: "已完成",
        category: "DONE",
        isEnd: true,
      },
      {
        code: "CANCELED",
        name: "已取消",
        category: "TERMINATED",
        isEnd: true,
      },
    ],
    actions: [
      {
        code: "START_PROGRESS",
        name: "开始处理",
        fromStateCode: "PENDING",
        toStateCode: "IN_PROGRESS",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
      },
      {
        code: "MARK_BLOCKED",
        name: "标记阻塞",
        fromStateCode: "IN_PROGRESS",
        toStateCode: "BLOCKED",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
        formFields: [
          {
            key: "blockedReason",
            label: "阻塞原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "RESOLVE_BLOCKED",
        name: "解除阻塞",
        fromStateCode: "BLOCKED",
        toStateCode: "IN_PROGRESS",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
      },
      {
        code: "SUBMIT_TEST",
        name: "提交提测",
        fromStateCode: "IN_PROGRESS",
        toStateCode: "READY_FOR_TEST",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
        formFields: [
          {
            key: "testNote",
            label: "提测说明",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "START_TEST",
        name: "开始测试",
        fromStateCode: "READY_FOR_TEST",
        toStateCode: "TESTING",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
      },
      {
        code: "PASS_TEST",
        name: "测试通过",
        fromStateCode: "TESTING",
        toStateCode: "DONE",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
      },
      {
        code: "REJECT_TEST",
        name: "测试退回",
        fromStateCode: "TESTING",
        toStateCode: "IN_PROGRESS",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "rejectReason",
            label: "退回原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "CANCEL_TASK",
        name: "取消任务",
        fromStateCode: "IN_PROGRESS",
        toStateCode: "CANCELED",
        allowedSpaceRoles: managerRoles,
        actorRelations: [],
        formFields: [
          {
            key: "cancelReason",
            label: "取消原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
    ],
  },
  {
    code: "GENERAL_TASK",
    name: "通用任务默认流程",
    description: "系统内置通用任务流程，用于处理、确认和关闭普通任务。",
    version: 1,
    binding: {
      workItemType: "TASK",
      isDefault: true,
    },
    states: [
      {
        code: "PENDING",
        name: "待处理",
        category: "NOT_STARTED",
        isStart: true,
      },
      {
        code: "IN_PROGRESS",
        name: "处理中",
        category: "IN_PROGRESS",
      },
      {
        code: "PENDING_CONFIRMATION",
        name: "待确认",
        category: "VERIFYING",
      },
      {
        code: "DONE",
        name: "已完成",
        category: "DONE",
        isEnd: true,
      },
      {
        code: "CANCELED",
        name: "已取消",
        category: "TERMINATED",
        isEnd: true,
      },
    ],
    actions: [
      {
        code: "START_PROGRESS",
        name: "开始处理",
        fromStateCode: "PENDING",
        toStateCode: "IN_PROGRESS",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
      },
      {
        code: "SUBMIT_CONFIRMATION",
        name: "提交确认",
        fromStateCode: "IN_PROGRESS",
        toStateCode: "PENDING_CONFIRMATION",
        allowedSpaceRoles: taskAssigneeRoles,
        actorRelations: assigneeRelation,
        formFields: [
          {
            key: "completionNote",
            label: "完成说明",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "CONFIRM_DONE",
        name: "确认完成",
        fromStateCode: "PENDING_CONFIRMATION",
        toStateCode: "DONE",
        allowedSpaceRoles: managerRoles,
        actorRelations: [],
      },
      {
        code: "RETURN_PROCESSING",
        name: "退回处理",
        fromStateCode: "PENDING_CONFIRMATION",
        toStateCode: "IN_PROGRESS",
        allowedSpaceRoles: managerRoles,
        actorRelations: [],
        formFields: [
          {
            key: "rejectReason",
            label: "退回原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "CANCEL_TASK",
        name: "取消任务",
        fromStateCode: "IN_PROGRESS",
        toStateCode: "CANCELED",
        allowedSpaceRoles: managerRoles,
        actorRelations: [],
        formFields: [
          {
            key: "cancelReason",
            label: "取消原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
    ],
  },
  {
    code: "BUG",
    name: "Bug 默认流程",
    description: "系统内置 Bug 流程，用于缺陷确认、修复、回归和关闭。",
    version: 1,
    binding: {
      workItemType: "BUG",
      isDefault: true,
    },
    states: [
      {
        code: "PENDING_CONFIRMATION",
        name: "待确认",
        category: "NOT_STARTED",
        isStart: true,
      },
      {
        code: "PENDING_FIX",
        name: "待修复",
        category: "WAITING",
      },
      {
        code: "FIXING",
        name: "修复中",
        category: "IN_PROGRESS",
      },
      {
        code: "PENDING_REGRESSION",
        name: "待回归",
        category: "VERIFYING",
      },
      {
        code: "REGRESSION_PASSED",
        name: "回归通过",
        category: "DONE",
      },
      {
        code: "CLOSED",
        name: "已关闭",
        category: "DONE",
        isEnd: true,
      },
      {
        code: "REJECTED",
        name: "已拒绝",
        category: "TERMINATED",
        isEnd: true,
      },
    ],
    actions: [
      {
        code: "CONFIRM_DEFECT",
        name: "确认缺陷",
        fromStateCode: "PENDING_CONFIRMATION",
        toStateCode: "PENDING_FIX",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "fixAssigneeId",
            label: "修复负责人",
            fieldType: "USER",
            required: true,
          },
        ],
      },
      {
        code: "REJECT_DEFECT",
        name: "拒绝缺陷",
        fromStateCode: "PENDING_CONFIRMATION",
        toStateCode: "REJECTED",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "rejectReason",
            label: "拒绝原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "START_FIX",
        name: "开始修复",
        fromStateCode: "PENDING_FIX",
        toStateCode: "FIXING",
        allowedSpaceRoles: bugFixRoles,
        actorRelations: assigneeRelation,
      },
      {
        code: "SUBMIT_REGRESSION",
        name: "提交回归",
        fromStateCode: "FIXING",
        toStateCode: "PENDING_REGRESSION",
        allowedSpaceRoles: bugFixRoles,
        actorRelations: assigneeRelation,
        formFields: [
          {
            key: "fixSummary",
            label: "修复说明",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "REGRESSION_PASS",
        name: "回归通过",
        fromStateCode: "PENDING_REGRESSION",
        toStateCode: "REGRESSION_PASSED",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "regressionConclusion",
            label: "回归结论",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "REGRESSION_FAIL",
        name: "回归不通过",
        fromStateCode: "PENDING_REGRESSION",
        toStateCode: "PENDING_FIX",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "failedReason",
            label: "不通过原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
      {
        code: "CLOSE_DEFECT",
        name: "关闭缺陷",
        fromStateCode: "REGRESSION_PASSED",
        toStateCode: "CLOSED",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
      },
      {
        code: "REOPEN_DEFECT",
        name: "重新打开",
        fromStateCode: "CLOSED",
        toStateCode: "PENDING_FIX",
        allowedSpaceRoles: testingRoles,
        actorRelations: [],
        formFields: [
          {
            key: "reopenReason",
            label: "重开原因",
            fieldType: "TEXTAREA",
            required: true,
          },
        ],
      },
    ],
  },
] as const;

