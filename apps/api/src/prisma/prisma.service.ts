import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientInstance,
} from "../generated/prisma/client";

type PrismaClientConstructor = new (
  options: Prisma.PrismaClientOptions,
) => PrismaClientInstance;

const PrismaClientWithOptions =
  PrismaClient as unknown as PrismaClientConstructor;

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private prisma?: PrismaClientInstance;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  get client(): PrismaClientInstance {
    this.prisma ??= new PrismaClientWithOptions(this.createClientOptions());
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
      };
    }

    return {
      adapter: new PrismaPg({ connectionString: databaseUrl }),
      errorFormat: "minimal",
    } as Prisma.PrismaClientOptions;
  }
}
