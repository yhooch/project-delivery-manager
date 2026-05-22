import { Controller, Get } from "@nestjs/common";
import {
  buildRuntimeVersionProof,
  type RuntimeVersionEnv,
  type RuntimeVersionProof,
} from "@project-delivery/shared";

type HealthResponse = RuntimeVersionProof<"api">;

export function getApiHealth(
  env: RuntimeVersionEnv = process.env,
): HealthResponse {
  return buildRuntimeVersionProof("api", env);
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return getApiHealth();
  }
}
