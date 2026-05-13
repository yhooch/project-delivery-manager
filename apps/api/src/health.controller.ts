import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      data: {
        service: "api",
        status: "ok",
      },
      requestId: "bootstrap",
    };
  }
}

