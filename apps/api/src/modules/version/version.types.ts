import type {
  PageResult,
  Version,
  VersionStatus,
} from "@project-delivery/shared";

export type VersionListInput = {
  ownerId?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: VersionStatus;
};

export type VersionListResult = PageResult<Version>;

export type CreateVersionInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  name: string;
  target?: string;
  description?: string;
  ownerId?: string;
  status?: VersionStatus;
  startDate?: Date;
  targetDate?: Date;
  releaseDate?: Date;
  createdById: string;
};

export type UpdateVersionInput = {
  versionId: string;
  name?: string;
  target?: string;
  description?: string;
  ownerId?: string;
  status?: VersionStatus;
  startDate?: Date;
  targetDate?: Date;
  releaseDate?: Date;
  updatedById: string;
};
