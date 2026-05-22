import { createHash } from "node:crypto";
import path from "node:path";

const TEMPLATE_VARIABLE_PATTERN =
  /\{\{\s*(?<braced>[A-Z][A-Z0-9_]*)\s*\}\}|\$\{(?<dollar>[A-Z][A-Z0-9_]*)\}/gu;
const UNRESOLVED_VARIABLE_PATTERN =
  /\{\{\s*[A-Z][A-Z0-9_]*\s*\}\}|\$\{[A-Z][A-Z0-9_]*\}/gu;
const SAFE_CONFIG_NAME_PATTERN = /^[A-Za-z0-9._-]+\.conf$/u;

export type NginxRenderInput = {
  template: string;
  variables: Readonly<Record<string, string | undefined>>;
  requiredVariables?: readonly string[];
  expectedTemplateSha256?: string;
};

export type NginxRenderResult = {
  rendered: string;
  templateSha256: string;
  renderedSha256: string;
  usedVariables: string[];
};

export type NginxDeploymentPlanInput = {
  rootDir: string;
  releaseId: string;
  renderedConfig: string;
  expectedRenderedSha256?: string;
  configFileName?: string;
  nginxImage?: string;
  composeProject?: string;
  composeFile?: string;
  healthcheckUrl?: string;
  allowedRoots?: readonly string[];
};

export type NginxCommandPlanItem = {
  id: string;
  description: string;
  command: string[];
};

export type NginxDeploymentPlan = {
  activeDir: string;
  stagingDir: string;
  releaseDir: string;
  activeConfigPath: string;
  stagingConfigPath: string;
  releaseConfigPath: string;
  renderedSha256: string;
  commandPlan: NginxCommandPlanItem[];
  rollbackCommandPlan: NginxCommandPlanItem[];
};

export class NginxPlanError extends Error {
  constructor(
    readonly code:
      | "NGINX_TEMPLATE_CHECKSUM_MISMATCH"
      | "NGINX_REQUIRED_VARIABLE_MISSING"
      | "NGINX_UNRESOLVED_VARIABLE"
      | "NGINX_PATH_NOT_ALLOWED"
      | "NGINX_INVALID_CONFIG_NAME",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "NginxPlanError";
  }
}

export function renderNginxTemplate(
  input: NginxRenderInput,
): NginxRenderResult {
  const templateSha256 = sha256Text(input.template);

  if (
    input.expectedTemplateSha256 &&
    input.expectedTemplateSha256 !== templateSha256
  ) {
    throw new NginxPlanError(
      "NGINX_TEMPLATE_CHECKSUM_MISMATCH",
      "nginx template checksum does not match manifest",
      { expected: input.expectedTemplateSha256, actual: templateSha256 },
    );
  }

  for (const variableName of input.requiredVariables ?? []) {
    if (!input.variables[variableName]) {
      throw new NginxPlanError(
        "NGINX_REQUIRED_VARIABLE_MISSING",
        `required nginx template variable is missing: ${variableName}`,
      );
    }
  }

  const usedVariables = new Set<string>();
  const rendered = input.template.replace(
    TEMPLATE_VARIABLE_PATTERN,
    (_match, _braced, _dollar, _offset, _text, groups) => {
      const variableName = groups?.braced ?? groups?.dollar;

      if (!variableName || !input.variables[variableName]) {
        return _match;
      }

      usedVariables.add(variableName);
      return input.variables[variableName] ?? "";
    },
  );
  const unresolvedVariables = findUnresolvedTemplateVariables(rendered);

  if (unresolvedVariables.length > 0) {
    throw new NginxPlanError(
      "NGINX_UNRESOLVED_VARIABLE",
      "nginx template contains unresolved variables",
      unresolvedVariables,
    );
  }

  return {
    rendered,
    templateSha256,
    renderedSha256: sha256Text(rendered),
    usedVariables: [...usedVariables].sort(),
  };
}

export function findUnresolvedTemplateVariables(value: string): string[] {
  return [...new Set(value.match(UNRESOLVED_VARIABLE_PATTERN) ?? [])].sort();
}

export function assertPathAllowed(
  targetPath: string,
  allowedRoots: readonly string[],
): string {
  const resolvedTarget = path.resolve(targetPath);
  const allowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);

    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });

  if (!allowed) {
    throw new NginxPlanError(
      "NGINX_PATH_NOT_ALLOWED",
      `path is outside allowed roots: ${targetPath}`,
      { allowedRoots },
    );
  }

  return resolvedTarget;
}

export function buildNginxDeploymentPlan(
  input: NginxDeploymentPlanInput,
): NginxDeploymentPlan {
  const rootDir = path.resolve(input.rootDir);
  const allowedRoots = input.allowedRoots ?? [rootDir];
  const configFileName = input.configFileName ?? "default.conf";

  if (!SAFE_CONFIG_NAME_PATTERN.test(configFileName)) {
    throw new NginxPlanError(
      "NGINX_INVALID_CONFIG_NAME",
      `invalid nginx config file name: ${configFileName}`,
    );
  }

  const renderedSha256 = sha256Text(input.renderedConfig);

  if (
    input.expectedRenderedSha256 &&
    input.expectedRenderedSha256 !== renderedSha256
  ) {
    throw new NginxPlanError(
      "NGINX_TEMPLATE_CHECKSUM_MISMATCH",
      "rendered nginx config checksum does not match expected checksum",
      { expected: input.expectedRenderedSha256, actual: renderedSha256 },
    );
  }

  const activeDir = assertPathAllowed(
    path.join(rootDir, "active"),
    allowedRoots,
  );
  const stagingDir = assertPathAllowed(
    path.join(rootDir, "staging"),
    allowedRoots,
  );
  const releaseDir = assertPathAllowed(
    path.join(rootDir, "releases", input.releaseId),
    allowedRoots,
  );
  const activeConfigPath = assertPathAllowed(
    path.join(activeDir, configFileName),
    allowedRoots,
  );
  const stagingConfigPath = assertPathAllowed(
    path.join(stagingDir, configFileName),
    allowedRoots,
  );
  const releaseConfigPath = assertPathAllowed(
    path.join(releaseDir, configFileName),
    allowedRoots,
  );
  const nginxImage = input.nginxImage ?? "nginx:1.27-alpine";
  const composeProject = input.composeProject ?? "pdm-prod";
  const composeFile = input.composeFile ?? "docker-compose.prod.yml";
  const healthcheckUrl =
    input.healthcheckUrl ?? "http://127.0.0.1/api/v1/health";

  return {
    activeDir,
    stagingDir,
    releaseDir,
    activeConfigPath,
    stagingConfigPath,
    releaseConfigPath,
    renderedSha256,
    commandPlan: [
      {
        id: "render-staging",
        description: "Write rendered nginx config into staging",
        command: [
          "write-file",
          stagingConfigPath,
          `<sha256:${renderedSha256}>`,
        ],
      },
      {
        id: "nginx-test-staging",
        description:
          "Validate staging config with the same nginx image version",
        command: [
          "docker",
          "run",
          "--rm",
          "-v",
          `${stagingDir}:/etc/nginx/conf.d:ro`,
          nginxImage,
          "nginx",
          "-t",
        ],
      },
      {
        id: "snapshot-release",
        description: "Persist release nginx config snapshot",
        command: ["cp", "-a", stagingDir, releaseDir],
      },
      {
        id: "activate-nginx",
        description: "Atomically replace active nginx config directory",
        command: [
          "sh",
          "-lc",
          `rm -rf ${shellQuote(`${activeDir}.rollback`)} && mv -T ${shellQuote(
            activeDir,
          )} ${shellQuote(`${activeDir}.rollback`)} && mv -T ${shellQuote(
            releaseDir,
          )} ${shellQuote(activeDir)}`,
        ],
      },
      {
        id: "reload-nginx",
        description: "Reload running nginx container",
        command: [
          "docker",
          "compose",
          "-p",
          composeProject,
          "-f",
          composeFile,
          "exec",
          "nginx",
          "nginx",
          "-s",
          "reload",
        ],
      },
      {
        id: "healthcheck-entry",
        description: "Check HTTP entry health after nginx reload",
        command: ["curl", "-fsS", healthcheckUrl],
      },
    ],
    rollbackCommandPlan: [
      {
        id: "rollback-active-nginx",
        description: "Restore previous active nginx config directory",
        command: ["mv", "-T", `${activeDir}.rollback`, activeDir],
      },
      {
        id: "rollback-reload-nginx",
        description: "Reload nginx after rollback",
        command: [
          "docker",
          "compose",
          "-p",
          composeProject,
          "-f",
          composeFile,
          "exec",
          "nginx",
          "nginx",
          "-s",
          "reload",
        ],
      },
      {
        id: "rollback-healthcheck-entry",
        description: "Check HTTP entry health after rollback",
        command: ["curl", "-fsS", healthcheckUrl],
      },
    ],
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
