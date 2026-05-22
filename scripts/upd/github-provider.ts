import { type UpdateErrorCode } from "../../packages/shared/src/update.ts";

export type GithubReleaseProviderConfig = {
  owner: string;
  repo: string;
  channel: string;
  token?: string;
  apiBaseUrl: string;
};

export type GithubReleaseAssetMetadata = {
  id: number;
  name: string;
  size: number;
  browserDownloadUrl: string;
  contentType?: string;
  digest?: string;
};

export type GithubReleaseMetadata = {
  id: number;
  tagName: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  assets: GithubReleaseAssetMetadata[];
};

export class GithubReleaseProviderError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GithubReleaseProviderError";
  }
}

export function buildGithubReleaseProviderConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GithubReleaseProviderConfig {
  const repository = env.UPD_GITHUB_REPOSITORY ?? env.GITHUB_REPOSITORY;
  const [repoOwner, repoName] = repository?.split("/") ?? [];
  const owner = env.UPD_GITHUB_OWNER ?? repoOwner;
  const repo = env.UPD_GITHUB_REPO ?? repoName;

  if (!owner || !repo) {
    throw new GithubReleaseProviderError(
      "UPDATE_MANIFEST_INVALID",
      "GitHub provider requires UPD_GITHUB_OWNER/UPD_GITHUB_REPO or UPD_GITHUB_REPOSITORY",
    );
  }

  return {
    owner,
    repo,
    channel: env.UPD_RELEASE_CHANNEL ?? env.RELEASE_CHANNEL ?? "stable",
    token: env.UPD_GITHUB_TOKEN ?? env.GITHUB_TOKEN,
    apiBaseUrl: env.UPD_GITHUB_API_BASE_URL ?? "https://api.github.com",
  };
}

export function buildGithubHeaders(
  config: Pick<GithubReleaseProviderConfig, "token">,
): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  };
}

export function redactGithubConfig(
  config: GithubReleaseProviderConfig,
): GithubReleaseProviderConfig {
  return {
    ...config,
    token: config.token ? redactToken(config.token) : undefined,
  };
}

export function latestReleaseUrl(config: GithubReleaseProviderConfig): string {
  return `${config.apiBaseUrl}/repos/${config.owner}/${config.repo}/releases/latest`;
}

export function releaseByTagUrl(
  config: GithubReleaseProviderConfig,
  tag: string,
): string {
  return `${config.apiBaseUrl}/repos/${config.owner}/${config.repo}/releases/tags/${encodeURIComponent(tag)}`;
}

export async function fetchLatestGithubRelease(
  config: GithubReleaseProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubReleaseMetadata> {
  const response = await fetchImpl(latestReleaseUrl(config), {
    headers: buildGithubHeaders(config),
  });

  return parseGithubReleaseResponse(response);
}

export async function fetchGithubReleaseByTag(
  config: GithubReleaseProviderConfig,
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubReleaseMetadata> {
  const response = await fetchImpl(releaseByTagUrl(config, tag), {
    headers: buildGithubHeaders(config),
  });

  return parseGithubReleaseResponse(response);
}

export function mapGithubStatusToUpdateError(status: number): UpdateErrorCode {
  if (status === 401 || status === 403) {
    return "UPDATE_ACCESS_DENIED";
  }

  if (status === 404) {
    return "UPDATE_MANIFEST_INVALID";
  }

  return "UPDATE_PROVIDER_UNAVAILABLE";
}

async function parseGithubReleaseResponse(
  response: Response,
): Promise<GithubReleaseMetadata> {
  if (!response.ok) {
    throw new GithubReleaseProviderError(
      mapGithubStatusToUpdateError(response.status),
      `GitHub release provider returned ${response.status}`,
      response.status,
    );
  }

  return mapGithubRelease(await response.json());
}

function mapGithubRelease(input: unknown): GithubReleaseMetadata {
  const release = input as {
    id: number;
    tag_name: string;
    name: string | null;
    draft: boolean;
    prerelease: boolean;
    published_at: string | null;
    assets?: Array<{
      id: number;
      name: string;
      size: number;
      browser_download_url: string;
      content_type?: string;
      digest?: string;
    }>;
  };

  return {
    id: release.id,
    tagName: release.tag_name,
    name: release.name,
    draft: release.draft,
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    assets: (release.assets ?? []).map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      browserDownloadUrl: asset.browser_download_url,
      contentType: asset.content_type,
      digest: asset.digest,
    })),
  };
}

function redactToken(token: string): string {
  if (token.length <= 8) {
    return "***";
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
