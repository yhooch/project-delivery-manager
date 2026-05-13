import { Controller, Get } from "@nestjs/common";

type HealthResponse = {
  service: "api";
  status: "ok";
};

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: "api",
      status: "ok",
    };
  }
}
