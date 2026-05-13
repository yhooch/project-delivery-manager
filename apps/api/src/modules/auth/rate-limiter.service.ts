import { HttpStatus, Injectable } from "@nestjs/common";

import { ApiException } from "../../http/api-exception";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

@Injectable()
export class RateLimiterService {
  private readonly entries = new Map<string, RateLimitEntry>();

  assertAllowed(options: RateLimitOptions, now = Date.now()): void {
    const entry = this.entries.get(options.key);

    if (!entry || entry.resetAt <= now) {
      return;
    }

    if (entry.count >= options.limit) {
      throw new ApiException(
        "RATE_LIMITED",
        "Too many attempts. Please retry later.",
        HttpStatus.TOO_MANY_REQUESTS,
        {
          retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
        },
      );
    }
  }

  record(options: RateLimitOptions, now = Date.now()): void {
    const entry = this.entries.get(options.key);

    if (!entry || entry.resetAt <= now) {
      this.entries.set(options.key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      return;
    }

    entry.count += 1;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
