import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  RealtimeEventsQuerySchema,
  RealtimeSequenceCursorSchema,
  type RealtimeEvent,
  type RealtimeEventsQuery,
  type RealtimeSequenceCursor,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import {
  firstHeaderValue,
  type HeaderValue,
  type RequestWithContext,
} from "../../http/request-context";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { RequireSessionGuard } from "../auth/session.guard";
import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimePermissionService } from "./realtime-permission.service";
import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import {
  createHeartbeatSseMessage,
  createRealtimeSseMessage,
  createResyncSseMessage,
} from "./realtime-sse.formatter";
import {
  prepareRealtimeSseResponse,
  REALTIME_SSE_HEARTBEAT_INTERVAL_MS,
  type RealtimeSseResponse,
  writeRealtimeSseMessage,
} from "./realtime-sse.stream";

type RealtimeSseRequest = RequestWithContext & {
  on?: (event: "close", listener: () => void) => unknown;
};

@Controller("realtime/events")
export class RealtimeSseController {
  constructor(
    @Inject(RealtimeHubService)
    private readonly hub: RealtimeHubService,
    @Inject(RealtimeReplayBufferService)
    private readonly replayBuffer: RealtimeReplayBufferService,
    @Inject(RealtimePermissionService)
    private readonly permissions: RealtimePermissionService,
  ) {}

  @Get()
  @UseGuards(RequireSessionGuard)
  async subscribe(
    @Query(new ZodValidationPipe(RealtimeEventsQuerySchema))
    query: RealtimeEventsQuery,
    @Req() request: RealtimeSseRequest,
    @Res() response: RealtimeSseResponse,
  ): Promise<void> {
    const session = request.session;

    if (!session) {
      throw new ApiException(
        "UNAUTHORIZED",
        "Authentication is required",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const cursor = resolveReplayCursor(query, request.headers);

    prepareRealtimeSseResponse(response);

    let closed = false;
    let buffering = true;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let liveDelivery: Promise<void> = Promise.resolve();
    const bufferedEvents: RealtimeEvent[] = [];

    const deliverIfReadable = async (event: RealtimeEvent) => {
      if (
        closed ||
        !(await this.permissions.canReadEvent(session.userId, event))
      ) {
        return;
      }

      writeRealtimeSseMessage(
        response,
        createRealtimeSseMessage(
          event,
          this.replayBuffer.createCursor(event.sequence),
        ),
      );
    };

    const enqueueLiveDelivery = (event: RealtimeEvent) => {
      liveDelivery = liveDelivery
        .catch(() => undefined)
        .then(() => deliverIfReadable(event));

      return liveDelivery;
    };

    const handle = this.hub.subscribe({
      listener: (event) => {
        if (closed) {
          return;
        }

        if (buffering) {
          bufferedEvents.push(event);
          return;
        }

        return enqueueLiveDelivery(event);
      },
      metadata: {
        sessionId: session.sessionId,
        userId: session.userId,
      },
    });

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      handle.unsubscribe();

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    };

    request.on?.("close", cleanup);
    response.on?.("close", cleanup);
    response.on?.("error", cleanup);

    const replay = this.replayBuffer.replayAfter(cursor);
    const skipBufferedThroughSequence = replay.currentSequence;

    if (replay.ok) {
      for (const event of replay.events) {
        await deliverIfReadable(event);
      }
    } else {
      writeRealtimeSseMessage(response, createResyncSseMessage(replay.reason));
    }

    let index = 0;

    while (index < bufferedEvents.length) {
      const event = bufferedEvents[index];
      index += 1;

      if (event.sequence > skipBufferedThroughSequence) {
        await deliverIfReadable(event);
      }
    }

    buffering = false;

    if (!closed) {
      heartbeatTimer = setInterval(() => {
        writeRealtimeSseMessage(response, createHeartbeatSseMessage());
      }, REALTIME_SSE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
    }
  }
}

export function resolveReplayCursor(
  query: RealtimeEventsQuery,
  headers: Record<string, HeaderValue> | undefined,
): RealtimeSequenceCursor | undefined {
  if (query.lastEventId) {
    return query.lastEventId;
  }

  const headerValue = firstHeaderValue(
    headers?.["last-event-id"] ?? headers?.["Last-Event-ID"],
  );

  if (headerValue === undefined || headerValue.trim() === "") {
    return undefined;
  }

  const result = RealtimeSequenceCursorSchema.safeParse(headerValue);

  if (result.success) {
    return result.data;
  }

  throw new ApiException(
    "VALIDATION_ERROR",
    "Validation failed",
    HttpStatus.BAD_REQUEST,
    {
      issues: result.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: ["Last-Event-ID"],
      })),
    },
  );
}
