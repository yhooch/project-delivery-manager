#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";

import { UpdateManifestSchema } from "../../packages/shared/src/update.ts";
import { UpdaterStateStore } from "./state.ts";

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  const store = new UpdaterStateStore({ stateDir: args.stateDir });

  if (command === "status") {
    console.log(JSON.stringify(await store.readStatus(), null, 2));
    return;
  }

  if (command === "dry-run") {
    const manifestPath = required(args.manifest, "--manifest");
    const manifest = UpdateManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    console.log(JSON.stringify(await store.createDryRunJob(manifest), null, 2));
    return;
  }

  if (command === "job") {
    console.log(
      JSON.stringify(await store.readJob(required(args.id, "--id")), null, 2),
    );
    return;
  }

  throw new Error("Usage: state-cli.ts status|dry-run|job");
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const args: Record<string, string | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required option ${name}`);
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
