import { z } from "zod";

export const LocaleSchema = z.enum(["zh-CN", "en-US"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const ThemeModeSchema = z.enum(["SYSTEM", "LIGHT", "DARK"]);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const OrganizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const RecordStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type RecordStatus = z.infer<typeof RecordStatusSchema>;

export const TargetTypeSchema = z.enum([
  "SPACE",
  "VERSION",
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
  "DOCUMENT",
]);
export type TargetType = z.infer<typeof TargetTypeSchema>;

export const AttachmentTargetTypeSchema = z.enum([
  "REQUIREMENT",
  "WORK_ITEM",
  "DOCUMENT",
]);
export type AttachmentTargetType = z.infer<typeof AttachmentTargetTypeSchema>;

export const CommentTargetTypeSchema = z.enum([
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
  "DOCUMENT",
]);
export type CommentTargetType = z.infer<typeof CommentTargetTypeSchema>;

export const ObjectParticipantTargetTypeSchema = z.enum([
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
  "DOCUMENT",
]);
export type ObjectParticipantTargetType = z.infer<
  typeof ObjectParticipantTargetTypeSchema
>;

export const TagTargetTypeSchema = z.enum([
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
  "DOCUMENT",
]);
export type TagTargetType = z.infer<typeof TagTargetTypeSchema>;

export const ObjectParticipantRelationSchema = z.enum([
  "CREATOR",
  "ASSIGNEE",
  "REPORTER",
  "COMMENTER",
  "RELATED",
]);
export type ObjectParticipantRelation = z.infer<
  typeof ObjectParticipantRelationSchema
>;

export const WorkflowActorRelationSchema = z.enum([
  "ASSIGNEE",
  "REPORTER",
  "CREATOR",
  "SPACE_OWNER",
]);
export type WorkflowActorRelation = z.infer<
  typeof WorkflowActorRelationSchema
>;

export const SpaceRoleSchema = z.enum([
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
  "VIEWER",
]);
export type SpaceRole = z.infer<typeof SpaceRoleSchema>;

export const WorkItemTypeSchema = z.enum(["TASK", "BUG"]);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const StatusCategorySchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
]);
export type StatusCategory = z.infer<typeof StatusCategorySchema>;

export const RequirementStatusSchema = z.enum([
  "DRAFT",
  "CONFIRMED",
  "ARCHIVED",
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const IntakeStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "DEFERRED",
  "REJECTED",
  "CONVERTED",
]);
export type IntakeStatus = z.infer<typeof IntakeStatusSchema>;

export const IntakeSourceTypeSchema = z.enum([
  "REQUIREMENT_CHANGE",
  "DEFECT_PROBLEM",
  "PROJECT_PLAN",
  "MEETING_DECISION",
  "AD_HOC",
  "IMPLEMENTATION",
  "OPERATIONS",
  "RELEASE",
  "EXTERNAL_COLLABORATION",
]);
export type IntakeSourceType = z.infer<typeof IntakeSourceTypeSchema>;

export const WorkflowDefinitionStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "DISABLED",
]);
export type WorkflowDefinitionStatus = z.infer<
  typeof WorkflowDefinitionStatusSchema
>;

export const WorkflowVersionStatusSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "DISABLED",
]);
export type WorkflowVersionStatus = z.infer<typeof WorkflowVersionStatusSchema>;

export const ActionFormFieldTypeSchema = z.enum([
  "TEXT",
  "TEXTAREA",
  "SELECT",
  "USER",
  "DATE",
  "NUMBER",
]);
export type ActionFormFieldType = z.infer<typeof ActionFormFieldTypeSchema>;

export const TimelineEventTypeSchema = z.enum([
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "ACTION_EXECUTED",
  "ASSIGNEE_CHANGED",
  "COMMENTED",
  "ATTACHMENT_ADDED",
  "CLOSED",
  "REOPENED",
]);
export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>;

export const AuditActionSchema = z.enum([
  "LOGIN",
  "LOGOUT",
  "ACCESS_DENIED",
  "CREATE",
  "UPDATE",
  "DELETE",
  "ROLE_CHANGED",
  "SESSION_REVOKED",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const BugSeveritySchema = z.enum([
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
]);
export type BugSeverity = z.infer<typeof BugSeveritySchema>;

export const DocumentSourceTypeSchema = z.enum([
  "UPLOAD_DOCX",
  "UPLOAD_MARKDOWN",
  "PASTE_MARKDOWN",
  "PASTE_TEXT",
  "MCP_CREATED",
]);
export type DocumentSourceType = z.infer<typeof DocumentSourceTypeSchema>;

export const DocumentActorTypeSchema = z.enum(["USER", "MCP_CLIENT"]);
export type DocumentActorType = z.infer<typeof DocumentActorTypeSchema>;

export const DocumentStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentChangeTypeSchema = z.enum([
  "CREATED",
  "IMPORTED",
  "REIMPORTED",
  "METADATA_UPDATED",
  "CONTENT_EDITED",
  "CONTENT_APPENDED",
  "CONTENT_REPLACED",
  "ARCHIVED",
  "RESTORED",
  "DELETED",
]);
export type DocumentChangeType = z.infer<typeof DocumentChangeTypeSchema>;

export const DocumentLinkTargetTypeSchema = z.enum([
  "DOCUMENT",
  "VERSION",
  "REQUIREMENT",
  "INTAKE_ITEM",
  "WORK_ITEM",
]);
export type DocumentLinkTargetType = z.infer<
  typeof DocumentLinkTargetTypeSchema
>;

export const ViewExceptionTypeSchema = z.enum([
  "overdue",
  "blocked",
  "pending_confirm",
  "pending_regression",
  "stale",
]);
export type ViewExceptionType = z.infer<typeof ViewExceptionTypeSchema>;
