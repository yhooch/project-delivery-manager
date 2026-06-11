import { inflateRawSync } from "node:zlib";

import {
  DocumentMaxImportSizeBytes,
  DocumentMaxMarkdownBytes,
  DocumentSupportedDocxMimeTypes,
  DocumentSupportedHtmlMimeTypes,
  DocumentSupportedMarkdownMimeTypes,
  type DocumentLinkTarget,
} from "@project-delivery/shared";

export type DocumentContentChunkInput = {
  headingPath?: string;
  ordinal: number;
  contentText: string;
};

export type UploadedDocumentFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
};

const base64ImagePattern = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/giu;
const zipEndOfCentralDirectorySignature = 0x06054b50;
const zipCentralDirectoryFileHeaderSignature = 0x02014b50;
const zipLocalFileHeaderSignature = 0x04034b50;
const zipMaxCommentBytes = 0xffff;
const zipEndOfCentralDirectoryMinBytes = 22;
const zipCentralDirectoryFileHeaderBytes = 46;
const zipLocalFileHeaderBytes = 30;
const docxMaxZipEntries = 2_048;
const docxMaxDeclaredCompressedBytes = DocumentMaxImportSizeBytes;
const docxMaxDeclaredUncompressedBytes = DocumentMaxImportSizeBytes * 5;
const docxMaxCompressionRatio = 100;
const docxRequiredEntries = new Set([
  "[Content_Types].xml",
  "word/document.xml",
]);
const htmlMaxZipEntries = 2_048;
const htmlMaxDeclaredCompressedBytes = DocumentMaxImportSizeBytes;
const htmlMaxDeclaredUncompressedBytes = DocumentMaxImportSizeBytes;
const htmlMaxCompressionRatio = 100;
const htmlRootIndexFileNames = new Set(["index.html", "index.htm"]);
const htmlFileMimeTypes = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/octet-stream",
]);
const htmlZipMimeTypes = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);
const docxZipContext = {
  label: "DOCX",
  maxEntries: docxMaxZipEntries,
} as const;
const htmlZipContext = {
  label: "HTML ZIP",
  maxEntries: htmlMaxZipEntries,
} as const;

type ZipCentralDirectoryEntry = {
  compressedSize: number;
  compressionMethod: number;
  fileName: string;
  localHeaderOffset: number;
  uncompressedSize: number;
};
type ZipReadContext = {
  label: string;
  maxEntries: number;
};

export type HtmlZipEntry = ZipCentralDirectoryEntry;

export function normalizeMarkdownSource(input: {
  contentMarkdown: string;
  fallbackTitle: string;
  title?: string;
}) {
  const contentMarkdown = stripBase64Images(input.contentMarkdown).trim();
  const contentText = markdownToText(contentMarkdown);
  const title = normalizeTitle(
    input.title ??
      extractTitleFromMarkdown(contentMarkdown) ??
      input.fallbackTitle,
  );

  return {
    contentMarkdown,
    contentText,
    title,
  };
}

export function markdownToText(markdown: string): string {
  return markdown
    .replaceAll(base64ImagePattern, "[image omitted]")
    .replace(/```[\s\S]*?```/gu, (block) =>
      block.replace(/```[a-z0-9_-]*\n?/iu, "").replace(/```$/u, ""),
    )
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^>\s?/gmu, "")
    .replace(/^[-*+]\s+/gmu, "")
    .replace(/^\d+\.\s+/gmu, "")
    .replace(/[*_~#]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function buildDocumentChunks(
  markdown: string,
): DocumentContentChunkInput[] {
  const chunks: DocumentContentChunkInput[] = [];
  const headingStack: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const contentText = markdownToText(buffer.join("\n")).trim();

    buffer = [];
    if (!contentText) {
      return;
    }

    chunks.push({
      ordinal: chunks.length,
      headingPath:
        headingStack.length > 0 ? headingStack.join(" / ") : undefined,
      contentText,
    });
  };

  for (const line of markdown.replace(/\r\n?/gu, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);

    if (heading) {
      flush();
      const level = heading[1].length;
      headingStack.length = level - 1;
      headingStack[level - 1] = markdownToText(heading[2]).slice(0, 200);
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    buffer.push(line);
  }

  flush();

  if (chunks.length === 0) {
    const contentText = markdownToText(markdown);

    return contentText
      ? [
          {
            ordinal: 0,
            contentText,
          },
        ]
      : [];
  }

  return chunks;
}

export function buildDocumentChunksFromText(
  text: string,
): DocumentContentChunkInput[] {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((contentText, ordinal) => ({
      ordinal,
      contentText,
    }));
}

export function normalizeTiptapSource(input: {
  contentJson: Record<string, unknown>;
  contentMarkdownCache?: string;
}) {
  const contentText = extractTextFromTiptapJson(input.contentJson);
  const contentMarkdownCache = stripBase64Images(
    input.contentMarkdownCache ?? contentText,
  ).trim();

  assertMarkdownSize(contentText);
  assertMarkdownSize(contentMarkdownCache);

  return {
    contentJson: input.contentJson,
    contentMarkdownCache,
    contentText,
  };
}

export function assertMarkdownImportFile(file: UploadedDocumentFile): void {
  assertImportSize(file);
  if (
    !hasExtension(file.fileName, [".md", ".markdown", ".txt"]) ||
    !DocumentSupportedMarkdownMimeTypes.includes(
      file.mimeType as (typeof DocumentSupportedMarkdownMimeTypes)[number],
    )
  ) {
    throwUnsupportedFileType();
  }
}

export function assertDocxImportFile(file: UploadedDocumentFile): void {
  assertImportSize(file);
  if (
    !hasExtension(file.fileName, [".docx"]) ||
    !DocumentSupportedDocxMimeTypes.includes(
      file.mimeType as (typeof DocumentSupportedDocxMimeTypes)[number],
    )
  ) {
    throwUnsupportedFileType();
  }
}

export function assertHtmlImportFile(file: UploadedDocumentFile): void {
  assertImportSize(file);
  if (isSingleHtmlImportFile(file) || isHtmlZipImportFile(file)) {
    return;
  }

  throwUnsupportedFileType();
}

export function isSingleHtmlImportFile(file: UploadedDocumentFile): boolean {
  const mimeType = file.mimeType.toLowerCase();

  return (
    hasExtension(file.fileName, [".html", ".htm"]) &&
    htmlFileMimeTypes.has(mimeType) &&
    DocumentSupportedHtmlMimeTypes.includes(
      mimeType as (typeof DocumentSupportedHtmlMimeTypes)[number],
    )
  );
}

export function isHtmlZipImportFile(file: UploadedDocumentFile): boolean {
  const mimeType = file.mimeType.toLowerCase();

  return (
    hasExtension(file.fileName, [".zip"]) &&
    htmlZipMimeTypes.has(mimeType) &&
    DocumentSupportedHtmlMimeTypes.includes(
      mimeType as (typeof DocumentSupportedHtmlMimeTypes)[number],
    )
  );
}

export function assertSafeDocxZip(file: UploadedDocumentFile): void {
  const entries = readZipCentralDirectory(file.buffer, docxZipContext);
  const requiredEntries = new Set(docxRequiredEntries);
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (const entry of entries) {
    requiredEntries.delete(entry.fileName);
    totalCompressedBytes += entry.compressedSize;
    totalUncompressedBytes += entry.uncompressedSize;

    if (
      entry.compressedSize > docxMaxDeclaredCompressedBytes ||
      entry.uncompressedSize > docxMaxDeclaredUncompressedBytes ||
      totalCompressedBytes > docxMaxDeclaredCompressedBytes ||
      totalUncompressedBytes > docxMaxDeclaredUncompressedBytes
    ) {
      throwFileTooLarge("DOCX archive declares too much content");
    }

    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > docxMaxCompressionRatio
    ) {
      throwDocxImportFailed("DOCX archive compression ratio is too high");
    }
  }

  if (requiredEntries.size > 0) {
    throwDocxImportFailed("DOCX archive is missing required document entries");
  }
}

export function readSafeHtmlZipEntries(
  file: UploadedDocumentFile,
): HtmlZipEntry[] {
  assertHtmlImportFile(file);
  if (!isHtmlZipImportFile(file)) {
    throwHtmlImportFailed("HTML import file is not a ZIP archive");
  }

  const entries = readZipCentralDirectory(file.buffer, htmlZipContext);
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (const entry of entries) {
    totalCompressedBytes += entry.compressedSize;
    totalUncompressedBytes += entry.uncompressedSize;

    if (
      entry.compressedSize > htmlMaxDeclaredCompressedBytes ||
      entry.uncompressedSize > htmlMaxDeclaredUncompressedBytes ||
      totalCompressedBytes > htmlMaxDeclaredCompressedBytes ||
      totalUncompressedBytes > htmlMaxDeclaredUncompressedBytes
    ) {
      throwFileTooLarge("HTML ZIP archive declares too much content");
    }

    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > htmlMaxCompressionRatio
    ) {
      throwHtmlImportFailed("HTML ZIP archive compression ratio is too high");
    }
  }

  return entries;
}

export function selectHtmlZipEntry(entries: HtmlZipEntry[]): HtmlZipEntry {
  const htmlEntries = entries.filter(
    (entry) =>
      !isZipDirectoryEntry(entry) &&
      hasExtension(entry.fileName, [".html", ".htm"]),
  );
  const rootIndexEntries = htmlEntries.filter((entry) =>
    htmlRootIndexFileNames.has(entry.fileName.toLowerCase()),
  );

  if (rootIndexEntries.length === 1) {
    return rootIndexEntries[0];
  }
  if (rootIndexEntries.length > 1) {
    throwHtmlImportFailed(
      "HTML ZIP archive has multiple root index HTML entries",
    );
  }
  if (htmlEntries.length === 1) {
    return htmlEntries[0];
  }
  if (htmlEntries.length === 0) {
    throwHtmlImportFailed("HTML ZIP archive is missing an HTML entry");
  }

  throwHtmlImportFailed(
    "HTML ZIP archive has multiple HTML entries and no root index.html",
  );
}

export function readHtmlZipEntryData(
  file: UploadedDocumentFile,
  entry: HtmlZipEntry,
): Buffer {
  return readZipEntryData(file.buffer, entry, htmlZipContext);
}

export function readDocxUtf8Entry(
  file: UploadedDocumentFile,
  fileName: string,
): string | undefined {
  const entry = readZipCentralDirectory(file.buffer, docxZipContext).find(
    (candidate) => candidate.fileName === fileName,
  );

  if (!entry) {
    return undefined;
  }

  return readZipEntryData(file.buffer, entry, docxZipContext).toString("utf8");
}

export function assertMarkdownSize(markdown: string): void {
  if (Buffer.byteLength(markdown, "utf8") > DocumentMaxMarkdownBytes) {
    throwFileTooLarge();
  }
}

export function normalizeUploadedFileName(fileName: string): string {
  const decoded = Buffer.from(fileName, "latin1").toString("utf8");

  return decoded.includes("\uFFFD") ? fileName : decoded;
}

export function normalizeDocumentLinks(
  links: DocumentLinkTarget[] | undefined,
): DocumentLinkTarget[] {
  const seen = new Set<string>();
  const result: DocumentLinkTarget[] = [];

  for (const link of links ?? []) {
    const key = `${link.targetType}:${link.targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(link);
  }

  return result;
}

export function stripBase64Images(markdown: string): string {
  return markdown.replaceAll(base64ImagePattern, "[image omitted]");
}

function extractTitleFromMarkdown(markdown: string): string | undefined {
  const firstHeading = /^#\s+(.+)$/mu.exec(markdown);

  return firstHeading ? markdownToText(firstHeading[1]) : undefined;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/gu, " ");

  return trimmed ? trimmed.slice(0, 200) : "Untitled document";
}

function extractTextFromTiptapJson(value: unknown): string {
  const text: string[] = [];

  collectTiptapText(value, text);

  return text.join(" ").replace(/\s+/gu, " ").trim();
}

function collectTiptapText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTiptapText(item, output);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    output.push(record.text);
  }

  if (Array.isArray(record.content)) {
    collectTiptapText(record.content, output);
  }
}

function assertImportSize(file: UploadedDocumentFile): void {
  if (file.size <= 0 || file.size > DocumentMaxImportSizeBytes) {
    throwFileTooLarge();
  }
}

function readZipCentralDirectory(
  buffer: Buffer,
  context: ZipReadContext,
): ZipCentralDirectoryEntry[] {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(
    buffer,
    context,
  );
  const entryCountOnDisk = buffer.readUInt16LE(endOfCentralDirectoryOffset + 8);
  const entryCount = buffer.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(
    endOfCentralDirectoryOffset + 12,
  );
  const centralDirectoryOffset = buffer.readUInt32LE(
    endOfCentralDirectoryOffset + 16,
  );

  if (entryCount === 0 || entryCount !== entryCountOnDisk) {
    throwZipImportFailed(
      context,
      `${context.label} archive central directory is invalid`,
    );
  }
  if (entryCount > context.maxEntries) {
    throwFileTooLarge(`${context.label} archive contains too many entries`);
  }
  if (
    centralDirectoryOffset >= endOfCentralDirectoryOffset ||
    centralDirectorySize > endOfCentralDirectoryOffset - centralDirectoryOffset
  ) {
    throwZipImportFailed(
      context,
      `${context.label} archive central directory is out of bounds`,
    );
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let position = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      position + zipCentralDirectoryFileHeaderBytes > centralDirectoryEnd ||
      buffer.readUInt32LE(position) !== zipCentralDirectoryFileHeaderSignature
    ) {
      throwZipImportFailed(
        context,
        `${context.label} archive central directory entry is invalid`,
      );
    }

    const flags = buffer.readUInt16LE(position + 8);
    const compressionMethod = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const fileNameLength = buffer.readUInt16LE(position + 28);
    const extraFieldLength = buffer.readUInt16LE(position + 30);
    const fileCommentLength = buffer.readUInt16LE(position + 32);
    const localHeaderOffset = buffer.readUInt32LE(position + 42);
    const entryLength =
      zipCentralDirectoryFileHeaderBytes +
      fileNameLength +
      extraFieldLength +
      fileCommentLength;
    const entryEnd = position + entryLength;

    if (entryEnd > centralDirectoryEnd) {
      throwZipImportFailed(
        context,
        `${context.label} archive central directory entry is out of bounds`,
      );
    }
    if ((flags & 0x0001) !== 0) {
      throwZipImportFailed(
        context,
        `Encrypted ${context.label} archives are not supported`,
      );
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throwZipImportFailed(
        context,
        `${context.label} archive uses an unsupported compression method`,
      );
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throwZipImportFailed(
        context,
        `ZIP64 ${context.label} archives are not supported`,
      );
    }
    if (localHeaderOffset >= centralDirectoryOffset) {
      throwZipImportFailed(
        context,
        `${context.label} archive local header offset is invalid`,
      );
    }

    const fileName = buffer
      .subarray(
        position + zipCentralDirectoryFileHeaderBytes,
        position + zipCentralDirectoryFileHeaderBytes + fileNameLength,
      )
      .toString("utf8");
    if (isUnsafeZipPath(fileName)) {
      throwZipImportFailed(
        context,
        `${context.label} archive entry path is invalid`,
      );
    }

    entries.push({
      compressedSize,
      compressionMethod,
      fileName,
      localHeaderOffset,
      uncompressedSize,
    });
    position = entryEnd;
  }

  if (position !== centralDirectoryEnd) {
    throwZipImportFailed(
      context,
      `${context.label} archive central directory has trailing data`,
    );
  }

  return entries;
}

function readZipEntryData(
  buffer: Buffer,
  entry: ZipCentralDirectoryEntry,
  context: ZipReadContext,
): Buffer {
  const position = entry.localHeaderOffset;

  if (
    position + zipLocalFileHeaderBytes > buffer.length ||
    buffer.readUInt32LE(position) !== zipLocalFileHeaderSignature
  ) {
    throwZipImportFailed(
      context,
      `${context.label} archive local file header is invalid`,
    );
  }

  const fileNameLength = buffer.readUInt16LE(position + 26);
  const extraFieldLength = buffer.readUInt16LE(position + 28);
  const dataStart =
    position + zipLocalFileHeaderBytes + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataStart > buffer.length || dataEnd > buffer.length) {
    throwZipImportFailed(
      context,
      `${context.label} archive entry data is out of bounds`,
    );
  }

  const compressed = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    if (compressed.length !== entry.uncompressedSize) {
      throwZipImportFailed(
        context,
        `${context.label} archive entry size is invalid`,
      );
    }

    return compressed;
  }

  let decompressed: Buffer;

  try {
    decompressed = inflateRawSync(compressed);
  } catch {
    throwZipImportFailed(
      context,
      `${context.label} archive entry data cannot be decompressed`,
    );
  }

  if (decompressed.length !== entry.uncompressedSize) {
    throwZipImportFailed(
      context,
      `${context.label} archive entry size is invalid`,
    );
  }

  return decompressed;
}

function findEndOfCentralDirectory(
  buffer: Buffer,
  context: ZipReadContext,
): number {
  if (buffer.length < zipEndOfCentralDirectoryMinBytes) {
    throwZipImportFailed(context, `${context.label} archive is too small`);
  }

  const minOffset = Math.max(
    0,
    buffer.length - zipEndOfCentralDirectoryMinBytes - zipMaxCommentBytes,
  );

  for (
    let offset = buffer.length - zipEndOfCentralDirectoryMinBytes;
    offset >= minOffset;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === zipEndOfCentralDirectorySignature) {
      return offset;
    }
  }

  throwZipImportFailed(
    context,
    `${context.label} archive end record is missing`,
  );
}

function isUnsafeZipPath(fileName: string): boolean {
  return (
    fileName.length === 0 ||
    fileName.startsWith("/") ||
    fileName.startsWith("\\") ||
    /^[a-z]:[\\/]/iu.test(fileName) ||
    fileName.split(/[\\/]+/u).includes("..")
  );
}

function isZipDirectoryEntry(
  entry: Pick<ZipCentralDirectoryEntry, "fileName">,
) {
  return entry.fileName.endsWith("/");
}

function hasExtension(fileName: string, extensions: string[]) {
  const lower = fileName.toLowerCase();

  return extensions.some((extension) => lower.endsWith(extension));
}

function throwFileTooLarge(message = "File is too large"): never {
  const error = new Error(message);
  Object.assign(error, { code: "FILE_TOO_LARGE" });
  throw error;
}

function throwUnsupportedFileType(): never {
  const error = new Error("Unsupported document file type");
  Object.assign(error, { code: "DOCUMENT_IMPORT_UNSUPPORTED_TYPE" });
  throw error;
}

function throwDocxImportFailed(message: string): never {
  const error = new Error(message);
  Object.assign(error, { code: "DOCUMENT_IMPORT_FAILED" });
  throw error;
}

function throwHtmlImportFailed(message: string): never {
  const error = new Error(message);
  Object.assign(error, { code: "DOCUMENT_IMPORT_FAILED" });
  throw error;
}

function throwZipImportFailed(context: ZipReadContext, message: string): never {
  if (context.label === "HTML ZIP") {
    throwHtmlImportFailed(message);
  }

  throwDocxImportFailed(message);
}
