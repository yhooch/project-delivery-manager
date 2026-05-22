import { AsyncLocalStorage } from "node:async_hooks";

export type RequestLogContext = {
  method?: string;
  organizationId?: string;
  path?: string;
  requestId: string;
  routePath?: string;
  spaceId?: string;
  userId?: string;
};

const requestLogContextStorage = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestLogContext<T>(
  context: RequestLogContext,
  callback: () => T,
): T {
  return requestLogContextStorage.run(context, callback);
}

export function getRequestLogContext(): RequestLogContext | undefined {
  return requestLogContextStorage.getStore();
}

export function updateRequestLogContext(
  patch: Partial<RequestLogContext>,
): void {
  const context = requestLogContextStorage.getStore();

  if (!context) {
    return;
  }

  Object.assign(context, compactContextPatch(patch));
}

function compactContextPatch(
  patch: Partial<RequestLogContext>,
): Partial<RequestLogContext> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<RequestLogContext>;
}
