import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { AuditService } from "./audit.service";

@Module({
  exports: [AuditService],
  imports: [PrismaModule],
  providers: [AuditService],
})
export class AuditModule {}
