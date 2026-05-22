#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildChecksums,
  buildReleaseManifestFromDirectory,
  DEFAULT_MANIFEST_FILE,
  UpdatePackageValidationError,
  validateReleasePackage,
  writeManifest,
  writeManifestSignature,
  type BuildReleaseManifestInput,
} from "./release.ts";

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);

  if (command === "checksums") {
    const releaseDir = required(args.dir, "--dir");
    console.log(JSON.stringify(await buildChecksums(releaseDir), null, 2));
    return;
  }

  if (command === "pack") {
    const releaseDir = required(args.dir, "--dir");
    const inputPath = required(args.input, "--input");
    const manifestPath =
      args.manifest ?? path.join(releaseDir, DEFAULT_MANIFEST_FILE);
    const manifest = await buildReleaseManifestFromDirectory(
      releaseDir,
      JSON.parse(
        await readFile(inputPath, "utf8"),
      ) as BuildReleaseManifestInput,
    );

    await writeManifest(manifestPath, manifest);

    if (args.privateKey) {
      await writeManifestSignature(
        manifestPath,
        args.signature ?? `${manifestPath}.sig`,
        await readFile(args.privateKey, "utf8"),
      );
    }

    console.log(
      JSON.stringify(
        {
          manifestPath,
          version: manifest.version,
          checksums: Object.keys(manifest.checksums).length,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "validate") {
    const releaseDir = required(args.dir, "--dir");
    const publicKeyPem = args.publicKey
      ? await readFile(args.publicKey, "utf8")
      : process.env.UPD_RELEASE_PUBLIC_KEY;
    const result = await validateReleasePackage({
      releaseDir,
      manifestPath: args.manifest,
      signaturePath: args.signature,
      publicKeyPem,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          version: result.manifest.version,
          checkedFiles: result.checkedFiles,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(
    "Usage: release-cli.ts checksums|pack|validate --dir <release-dir>",
  );
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
  if (error instanceof UpdatePackageValidationError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: error.code,
          message: error.message,
          details: error.details,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
