import {
  buildRuntimeVersionProof,
  type RuntimeVersionEnv,
  type RuntimeVersionProof,
} from "@project-delivery/shared";

export function getWebRuntimeVersionProof(
  env: RuntimeVersionEnv = process.env,
): RuntimeVersionProof<"web"> {
  return buildRuntimeVersionProof("web", env);
}
