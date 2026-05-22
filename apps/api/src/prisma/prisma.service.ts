import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientInstance,
} from "../generated/prisma/client";
import {
  logPrismaQueryEvent,
  shouldEnablePrismaQueryEvents,
} from "../observability/prisma-query-logger";

type PrismaClientConstructor = new (
  options: Prisma.PrismaClientOptions,
) => PrismaClientInstance;

type PrismaClientWithQueryEvents = PrismaClientInstance & {
  $on(
    eventType: "query",
    callback: (event: Prisma.QueryEvent) => void,
  ): PrismaClientWithQueryEvents;
};

const PrismaClientWithOptions =
  PrismaClient as unknown as PrismaClientConstructor;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private prisma?: PrismaClientWithQueryEvents;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  get client(): PrismaClientInstance {
    if (!this.prisma) {
      this.prisma = this.createClient();
    }

    return this.prisma;
  }

  async connect(): Promise<void> {
    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private createClient(): PrismaClientWithQueryEvents {
    const client = new PrismaClientWithOptions(
      this.createClientOptions(),
    ) as PrismaClientWithQueryEvents;

    if (shouldEnablePrismaQueryEvents(this.config)) {
      client.$on("query", (event) => {
        logPrismaQueryEvent(event, this.config, this.logger);
      });
    }

    return client;
  }

  private createClientOptions(): Prisma.PrismaClientOptions {
    const databaseUrl = this.config.get<string>("DATABASE_URL");

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required to create PrismaClient");
    }

    if (
      databaseUrl.startsWith("prisma://") ||
      databaseUrl.startsWith("prisma+postgres://")
    ) {
      return {
        accelerateUrl: databaseUrl,
        errorFormat: "minimal",
        log: this.createPrismaLogOptions(),
      };
    }

    return {
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      errorFormat: "minimal",
      log: this.createPrismaLogOptions(),
    } as Prisma.PrismaClientOptions;
  }

  private createPrismaLogOptions(): Prisma.PrismaClientOptions["log"] {
    return shouldEnablePrismaQueryEvents(this.config)
      ? [{ emit: "event", level: "query" }]
      : [];
  }
}
