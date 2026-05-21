import { type INestApplication } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { type ApiResponse, type RealtimeEvent } from "@project-delivery/shared";
import { firstValueFrom, of, type Observable } from "rxjs";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiResponseInterceptor } from "../../http/api-response.interceptor";
import { GlobalExceptionFilter } from "../../http/global-exception.filter";
import type { HeaderValue } from "../../http/request-context";
import { configureApp } from "../../main";
import { RequireSessionGuard } from "../auth/session.guard";
import { RealtimeConnectionRegistryService } from "./realtime-connection-registry.service";
import { RealtimeHubService } from "./realtime-hub.service";
import { RealtimePermissionService } from "./realtime-permission.service";
import { RealtimeReplayBufferService } from "./realtime-replay-buffer.service";
import {
  REALTIME_ACTOR_ID,
  createRealtimeEventFixture,
} from "./realtime-test.fixtures";
import {
  RealtimeSseController,
  resolveReplayCursor,
} from "./realtime-sse.controller";
import {
  REALTIME_SSE_HEARTBEAT_INTERVAL_MS,
  type RealtimeSseResponse,
} from "./realtime-sse.stream";

const session = {
  expiresAt: new Date("2026-05-21T13:00:00.000Z"),
  sessionId: "01H0000000000000000000000S",
  tokenHash: "token-hash",
  userId: REALTIME_ACTOR_ID,
};
const SSE_STREAM_ID = "01HRZ3NDEKTSV4RRFFQ69G5FAY";

describe("RealtimeSseController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers query lastEventId over Last-Event-ID header and validates header cursors", () => {
    expect(
      resolveReplayCursor({ lastEventId: "8" }, { "last-event-id": "7" }),
    ).toBe("8");
    expect(resolveReplayCursor({}, { "last-event-id": "7" })).toBe("7");
    expect(() => resolveReplayCursor({}, { "last-event-id": "0" })).toThrow(
      /Validation failed/u,
    );
  });

  it("replays buffered events after the cursor before opening live delivery", async () => {
    const { buffer, controller, registry, request, response } = createSubject();
    const first = createReplayableRealtimeEventFixture(1);
    const second = createReplayableRealtimeEventFixture(2);

    buffer.append(first);
    buffer.append(second);

    await controller.subscribe(
      { lastEventId: buffer.createCursor(1) },
      request,
      response,
    );

    expect(response.getHeader("Content-Type")).toContain("text/event-stream");
    expect(response.chunks).toHaveLength(1);
    expect(response.chunks[0]).toContain(
      `event: realtime\nid: ${buffer.createCursor(2)}\n`,
    );
    expect(response.chunks[0]).toContain(`"id":"${second.id}"`);
    expect(response.chunks[0]).toContain('"sequence":2');
    expect(registry.size).toBe(1);

    request.emitClose();

    expect(registry.size).toBe(0);
  });

  it("emits realtime-resync when replay reports a sequence gap", async () => {
    const { buffer, controller, request, response } = createSubject();

    buffer.append(createReplayableRealtimeEventFixture(1));
    buffer.append(createReplayableRealtimeEventFixture(3));

    await controller.subscribe(
      { lastEventId: buffer.createCursor(1) },
      request,
      response,
    );

    expect(response.chunks).toEqual([
      expect.stringContaining("event: realtime-resync\n"),
    ]);
    expect(response.chunks[0]).toContain('"reason":"SEQUENCE_GAP"');

    request.emitClose();
  });

  it("filters replayed and live events through realtime permissions", async () => {
    const { buffer, controller, hub, permissions, request, response } =
      createSubject();
    const hidden = createReplayableRealtimeEventFixture(2, {
      organizationId: "01H00000000000000000000005",
    });
    const visible = createReplayableRealtimeEventFixture(3);

    permissions.canReadEvent.mockImplementation(
      async (_userId: string, event: RealtimeEvent) => {
        return event.organizationId !== hidden.organizationId;
      },
    );
    buffer.append(createReplayableRealtimeEventFixture(1));
    buffer.append(hidden);
    buffer.append(visible);

    await controller.subscribe(
      { lastEventId: buffer.createCursor(1) },
      request,
      response,
    );

    expect(response.chunks).toHaveLength(1);
    expect(response.chunks[0]).toContain(`id: ${buffer.createCursor(3)}\n`);
    expect(response.chunks[0]).toContain(`"id":"${visible.id}"`);
    expect(response.chunks[0]).toContain('"sequence":3');

    hub.publish(hidden);
    hub.publish(createReplayableRealtimeEventFixture(4));
    await flushPromises();

    expect(response.chunks).toHaveLength(2);
    expect(response.chunks[1]).toContain(`id: ${buffer.createCursor(4)}\n`);

    request.emitClose();
  });

  it("sends heartbeat events and unsubscribes when the client disconnects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"));

    const { controller, hub, registry, request, response } = createSubject();

    await controller.subscribe({}, request, response);
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(REALTIME_SSE_HEARTBEAT_INTERVAL_MS);

    expect(response.chunks).toEqual([
      expect.stringContaining("event: heartbeat\n"),
    ]);

    request.emitClose();
    hub.publish(createRealtimeEventFixture(1));
    await Promise.resolve();

    expect(registry.size).toBe(0);
    expect(response.chunks).toHaveLength(1);
  });

  it("bypasses ApiResponseInterceptor wrapping after SSE content type is set", async () => {
    const interceptor = new ApiResponseInterceptor<undefined>();
    const response = new MockSseResponse();
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "request-id" }),
        getResponse: () => response,
      }),
    } as unknown as Parameters<
      ApiResponseInterceptor<undefined>["intercept"]
    >[0];

    const output = await firstValueFrom(
      interceptor.intercept(context, {
        handle: () => of(undefined),
      }) as unknown as Observable<ApiResponse<undefined> | undefined>,
    );

    expect(output).toBeUndefined();
  });
});

describe("RealtimeSseController auth guard", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RealtimeSseController],
      providers: [
        RealtimeConnectionRegistryService,
        RealtimeHubService,
        RequireSessionGuard,
        {
          provide: RealtimeReplayBufferService,
          useValue: new RealtimeReplayBufferService({
            maxEvents: 1000,
            ttlSeconds: 300,
          }),
        },
        {
          provide: RealtimePermissionService,
          useValue: {
            canReadEvent: vi.fn(),
          },
        },
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: ApiResponseInterceptor,
        },
      ],
    }).compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated SSE requests before establishing a stream", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/realtime/events")
      .expect(401);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Authentication is required",
    });
  });
});

function createSubject() {
  const registry = new RealtimeConnectionRegistryService();
  const hub = new RealtimeHubService(registry);
  const buffer = new RealtimeReplayBufferService({
    maxEvents: 1000,
    streamId: SSE_STREAM_ID,
    ttlSeconds: 300,
  });
  const permissions = {
    canReadEvent: vi.fn(async (_userId: string, _event: RealtimeEvent) => true),
  };
  const controller = new RealtimeSseController(
    hub,
    buffer,
    permissions as unknown as RealtimePermissionService,
  );
  const request = new MockRequest();
  const response = new MockSseResponse();

  return {
    buffer,
    controller,
    hub,
    permissions,
    registry,
    request,
    response,
  };
}

function createReplayableRealtimeEventFixture(
  sequence: number,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  return createRealtimeEventFixture(sequence, {
    occurredAt: new Date().toISOString(),
    ...overrides,
  });
}

class MockRequest {
  readonly headers: Record<string, HeaderValue> = {};
  readonly session = session;
  private readonly listeners = new Set<() => void>();

  on(event: "close", listener: () => void) {
    if (event === "close") {
      this.listeners.add(listener);
    }

    return this;
  }

  emitClose(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

class MockSseResponse implements RealtimeSseResponse {
  readonly chunks: string[] = [];
  readonly headers = new Map<string, string>();
  destroyed = false;
  writableEnded = false;

  end = vi.fn(() => {
    this.writableEnded = true;
  });

  flushHeaders = vi.fn(() => undefined);

  write = vi.fn((chunk: string) => {
    this.chunks.push(chunk);
    return true;
  });

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  on(_event: "close" | "error", _listener: () => void) {
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
