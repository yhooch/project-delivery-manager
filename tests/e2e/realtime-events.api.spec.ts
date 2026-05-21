import { expect, test } from "@playwright/test";

import {
  CreateCommentResponseSchema,
  RealtimeSseMessageSchema,
  UpdateWorkItemResponseSchema,
  type RealtimeInvalidationKey,
  type RealtimeOperation,
  type RealtimeSseMessage,
} from "../../packages/shared/src/index";
import {
  addOrganizationMember,
  addSpaceMember,
  buildM3RunId,
  createOrganization,
  createSpace,
  createTask,
  expectData,
  m3AuthHeaders,
  patch,
  post,
  registerAndLoginUser,
  skipWhenM3EnvironmentUnavailable,
  type M3User,
} from "./support/m3-env";
import { apiURL } from "./support/m0-env";

type RealtimeSseRealtimeMessage = Extract<
  RealtimeSseMessage,
  { event: "realtime" }
>;
type RealtimeSseResyncMessage = Extract<
  RealtimeSseMessage,
  { event: "realtime-resync" }
>;

type SseClient = {
  close: () => Promise<void>;
  readMessage: (
    predicate?: (message: RealtimeSseMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<RealtimeSseMessage | undefined>;
  response: Response;
};

type ReadOutcome =
  | {
      error?: undefined;
      result: ReadableStreamReadResult<Uint8Array>;
    }
  | {
      error: unknown;
      result?: undefined;
    };

test.describe.configure({ mode: "serial" });

test.describe("RT-J realtime SSE API 集成验收", () => {
  const runId = `rt_${buildM3RunId()}`.slice(0, 28);
  const password = `RT-e2e-${runId}-Pass1`;
  const users: M3User[] = [];

  test.afterAll(async () => {
    await Promise.all(users.map((user) => user.context.dispose()));
  });

  test("覆盖 SSE 鉴权、实时投递、replay、resync 和对象权限过滤", async () => {
    await skipWhenM3EnvironmentUnavailable();

    await expectUnauthenticatedSseRejected();

    const owner = await registerUser("owner");
    const pm = await registerUser("pm");
    const viewer = await registerUser("viewer");
    const orgOnlyUser = await registerUser("orgonly");
    const outsider = await registerUser("outside");

    const organization = await createOrganization(owner, runId);
    const space = await createSpace(owner, organization.id, runId, "main");

    for (const user of [pm, viewer, orgOnlyUser]) {
      await addOrganizationMember(owner, organization.id, user.username);
    }

    await addSpaceMember(owner, space.id, pm.id, "PM");
    await addSpaceMember(owner, space.id, viewer.id, "VIEWER");

    const clients: SseClient[] = [];
    const connectTracked = async (
      user: M3User,
      options: ConnectSseOptions = {},
    ) => {
      const client = await connectSse(user, options);
      clients.push(client);
      return client;
    };

    try {
      const viewerLive = await connectTracked(viewer);
      const orgOnlyLive = await connectTracked(orgOnlyUser);
      const outsiderLive = await connectTracked(outsider);

      expect(viewerLive.response.status).toBe(200);
      expect(viewerLive.response.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      const task = await createTask(pm, space.id, {
        assigneeId: pm.id,
        runId: `${runId}_created`,
      });
      const createdEvent = await expectRealtimeEvent(viewerLive, {
        invalidates: ["work-item-list", "timeline"],
        operation: "CREATED",
        targetId: task.id,
      });

      await expectNoSseMessage(orgOnlyLive, 750);
      await expectNoSseMessage(outsiderLive, 750);
      await Promise.all([orgOnlyLive.close(), outsiderLive.close()]);
      await viewerLive.close();

      await expectData(
        await patch(pm, `/work-items/${task.id}`, {
          priority: "LOW",
        }),
        UpdateWorkItemResponseSchema,
        "PATCH /work-items/:workItemId",
      );

      const queryReplay = await connectTracked(viewer, {
        queryLastEventId: createdEvent.id,
      });
      const updatedEvent = await expectRealtimeEvent(queryReplay, {
        invalidates: ["work-item-list", "timeline"],
        operation: "UPDATED",
        targetId: task.id,
      });
      expect(Number(updatedEvent.id)).toBeGreaterThan(Number(createdEvent.id));
      await queryReplay.close();

      await expectData(
        await post(pm, "/comments", {
          body: `RT-J replay comment ${runId}`,
          targetId: task.id,
          targetType: "WORK_ITEM",
        }),
        CreateCommentResponseSchema,
        "POST /comments",
      );

      const headerReplay = await connectTracked(viewer, {
        headerLastEventId: updatedEvent.id,
      });
      await expectRealtimeEvent(headerReplay, {
        invalidates: ["comments", "timeline"],
        operation: "COMMENTED",
        targetId: task.id,
      });
      await headerReplay.close();

      const resyncClient = await connectTracked(viewer, {
        queryLastEventId: "999999999999",
      });
      const resync = await expectResyncEvent(resyncClient);
      expect(resync.data.reason).toBe("SERVER_RESTART");
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  });

  async function registerUser(suffix: string): Promise<M3User> {
    const user = await registerAndLoginUser(
      `${runId}_${suffix}`.slice(0, 32),
      password,
    );

    users.push(user);

    return user;
  }
});

type ConnectSseOptions = {
  headerLastEventId?: string;
  queryLastEventId?: string;
};

async function expectUnauthenticatedSseRejected(): Promise<void> {
  const response = await fetch(apiURL("/realtime/events"), {
    headers: {
      Accept: "text/event-stream",
    },
  });

  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).toContain("application/json");

  await response.body?.cancel();
}

async function connectSse(
  user: M3User,
  options: ConnectSseOptions = {},
): Promise<SseClient> {
  const url = new URL(apiURL("/realtime/events"));

  if (options.queryLastEventId) {
    url.searchParams.set("lastEventId", options.queryLastEventId);
  }

  const abortController = new AbortController();
  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream",
      ...m3AuthHeaders(user),
      ...(options.headerLastEventId
        ? { "Last-Event-ID": options.headerLastEventId }
        : {}),
    },
    signal: abortController.signal,
  });

  if (!response.ok || !response.body) {
    abortController.abort();
    throw new Error(
      `GET /realtime/events returned HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;
  let pendingRead: Promise<ReadOutcome> | undefined;

  const readMessage: SseClient["readMessage"] = async (
    predicate = () => true,
    timeoutMs = 5_000,
  ) => {
    const deadline = Date.now() + timeoutMs;

    while (!closed && Date.now() < deadline) {
      let bufferedMessage = shiftBufferedMessage();

      while (bufferedMessage) {
        if (predicate(bufferedMessage)) {
          return bufferedMessage;
        }

        bufferedMessage = shiftBufferedMessage();
      }

      const remainingMs = Math.max(1, deadline - Date.now());
      const chunk = await readNextChunk(
        reader,
        () => pendingRead,
        (next) => {
          pendingRead = next;
        },
        remainingMs,
      );

      if (!chunk) {
        return undefined;
      }

      if (chunk.done) {
        throw new Error(
          "SSE stream ended before the expected message arrived.",
        );
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
    }

    return undefined;
  };

  return {
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      pendingRead = undefined;
      abortController.abort();

      await reader.cancel().catch(() => undefined);
    },
    readMessage,
    response,
  };

  function shiftBufferedMessage(): RealtimeSseMessage | undefined {
    while (true) {
      const frameEnd = buffer.indexOf("\n\n");

      if (frameEnd === -1) {
        return undefined;
      }

      const rawFrame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      const parsed = parseSseFrame(rawFrame);

      if (parsed) {
        return parsed;
      }
    }
  }
}

async function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  getPendingRead: () => Promise<ReadOutcome> | undefined,
  setPendingRead: (promise: Promise<ReadOutcome> | undefined) => void,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  const pendingRead =
    getPendingRead() ??
    reader.read().then(
      (result) => ({ result }) satisfies ReadOutcome,
      (error: unknown) => ({ error }) satisfies ReadOutcome,
    );

  setPendingRead(pendingRead);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  const outcome = await Promise.race([pendingRead, timeout]);

  if (timer) {
    clearTimeout(timer);
  }

  if (!outcome) {
    return undefined;
  }

  setPendingRead(undefined);

  if (outcome.error) {
    throw outcome.error;
  }

  return outcome.result;
}

function parseSseFrame(frame: string): RealtimeSseMessage | undefined {
  if (frame.trim() === "") {
    return undefined;
  }

  let eventName: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value;
    } else if (field === "id") {
      id = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (!eventName || dataLines.length === 0) {
    return undefined;
  }

  return RealtimeSseMessageSchema.parse({
    data: JSON.parse(dataLines.join("\n")) as unknown,
    event: eventName,
    ...(id === undefined ? {} : { id }),
  });
}

async function expectRealtimeEvent(
  client: SseClient,
  expected: {
    invalidates: RealtimeInvalidationKey[];
    operation: RealtimeOperation;
    targetId: string;
  },
): Promise<RealtimeSseRealtimeMessage> {
  const message = await client.readMessage((candidate) => {
    return (
      candidate.event === "realtime" &&
      candidate.data.target.id === expected.targetId &&
      candidate.data.operation === expected.operation
    );
  });

  expect(
    message,
    `应收到 ${expected.operation} realtime event target=${expected.targetId}`,
  ).toBeDefined();

  const realtime = message as RealtimeSseRealtimeMessage;

  expect(realtime.id).toBe(String(realtime.data.sequence));
  expect(realtime.data.target.type).toBe("WORK_ITEM");

  for (const key of expected.invalidates) {
    expect(realtime.data.invalidates).toContain(key);
  }

  return realtime;
}

async function expectResyncEvent(
  client: SseClient,
): Promise<RealtimeSseResyncMessage> {
  const message = await client.readMessage(
    (candidate) => candidate.event === "realtime-resync",
  );

  expect(message, "应收到 realtime-resync event").toBeDefined();

  return message as RealtimeSseResyncMessage;
}

async function expectNoSseMessage(
  client: SseClient,
  timeoutMs: number,
): Promise<void> {
  const message = await client.readMessage(() => true, timeoutMs);

  expect(message).toBeUndefined();
}
