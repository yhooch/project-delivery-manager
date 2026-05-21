import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import {
  ObjectCodeLookupQuerySchema,
  type ObjectCodeLookupQuery,
  type ObjectCodeLookupResult,
} from "@project-delivery/shared";

import type { RequestWithContext } from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CurrentUserService } from "../auth/current-user.service";
import { RequireSessionGuard } from "../auth/session.guard";
import { ObjectCodeService } from "./object-code.service";

@Controller()
@UseGuards(RequireSessionGuard)
export class ObjectCodeController {
  constructor(
    @Inject(ObjectCodeService)
    private readonly objectCodes: ObjectCodeService,
    @Inject(CurrentUserService)
    private readonly currentUser: CurrentUserService,
  ) {}

  @Get("object-code-lookup")
  async lookup(
    @Query(new ZodValidationPipe(ObjectCodeLookupQuerySchema))
    query: ObjectCodeLookupQuery,
    @Req() request: RequestWithContext,
  ): Promise<ObjectCodeLookupResult> {
    const session = this.currentUser.requireSession(request);

    return this.objectCodes.lookup(session.userId, query);
  }
}
