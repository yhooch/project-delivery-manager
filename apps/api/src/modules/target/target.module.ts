import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { RequirementModule } from "../requirement/requirement.module";
import { SpaceModule } from "../space/space.module";
import { TargetResolverService } from "./target-resolver.service";

@Module({
  exports: [TargetResolverService],
  imports: [PrismaModule, RequirementModule, SpaceModule],
  providers: [TargetResolverService],
})
export class TargetModule {}
