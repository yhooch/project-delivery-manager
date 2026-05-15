import type { Version } from "@project-delivery/shared";

import type {
  CreateVersionInput,
  UpdateVersionInput,
  VersionBoardInput,
  VersionBoardResult,
  VersionListInput,
  VersionListResult,
  VersionStatsScope,
} from "./version.types";

export const VERSION_REPOSITORY = Symbol("VERSION_REPOSITORY");

export type VersionRepository = {
  create(input: CreateVersionInput): Promise<Version>;
  findById(
    versionId: string,
    statsScope?: VersionStatsScope,
  ): Promise<Version | undefined>;
  findByName(
    spaceId: string,
    name: string,
  ): Promise<{ id: string } | undefined>;
  listBySpaceId(
    spaceId: string,
    input: VersionListInput,
  ): Promise<VersionListResult>;
  listBoard(input: VersionBoardInput): Promise<VersionBoardResult>;
  update(input: UpdateVersionInput): Promise<Version | undefined>;
};
