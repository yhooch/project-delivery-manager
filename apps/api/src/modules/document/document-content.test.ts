import { deflateRawSync } from "node:zlib";

import { DocumentMaxImportSizeBytes } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import {
  assertHtmlImportFile,
  assertSafeDocxZip,
  readHtmlZipEntryData,
  readSafeHtmlZipEntries,
  selectHtmlZipEntry,
  type UploadedDocumentFile,
} from "./document-content";

describe("document content DOCX safeguards", () => {
  it("accepts a DOCX-shaped zip with required entries", () => {
    expect(() => assertSafeDocxZip(docxFile())).not.toThrow();
  });

  it("rejects non-zip DOCX content before conversion", () => {
    expect(() =>
      assertSafeDocxZip(
        docxFile({
          buffer: Buffer.from("not a zip"),
          size: 9,
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IMPORT_FAILED",
      }),
    );
  });

  it("rejects DOCX archives whose declared uncompressed size is too large", () => {
    expect(() =>
      assertSafeDocxZip(
        docxFile({
          buffer: createZipBuffer([
            { fileName: "[Content_Types].xml", content: Buffer.from("types") },
            {
              compressedSize: 1,
              fileName: "word/document.xml",
              uncompressedSize: DocumentMaxImportSizeBytes * 5 + 1,
            },
          ]),
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "FILE_TOO_LARGE",
      }),
    );
  });

  it("rejects DOCX archives without the document body entry", () => {
    expect(() =>
      assertSafeDocxZip(
        docxFile({
          buffer: createZipBuffer([
            { fileName: "[Content_Types].xml", content: Buffer.from("types") },
          ]),
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IMPORT_FAILED",
      }),
    );
  });
});

describe("document content HTML safeguards", () => {
  it("accepts single HTML files", () => {
    expect(() =>
      assertHtmlImportFile(
        htmlFile({
          buffer: Buffer.from("<h1>HTML</h1>"),
          fileName: "document.htm",
          mimeType: "text/html",
        }),
      ),
    ).not.toThrow();
  });

  it("selects root index.html as the ZIP entry point", () => {
    const entries = readSafeHtmlZipEntries(
      htmlZipFile([
        { fileName: "chapter.html", content: Buffer.from("<p>Chapter</p>") },
        { fileName: "index.html", content: Buffer.from("<p>Index</p>") },
      ]),
    );

    expect(selectHtmlZipEntry(entries).fileName).toBe("index.html");
  });

  it("rejects HTML ZIP archives with ambiguous entry points", () => {
    expect(() =>
      selectHtmlZipEntry(
        readSafeHtmlZipEntries(
          htmlZipFile([
            { fileName: "a.html", content: Buffer.from("<p>A</p>") },
            { fileName: "b.html", content: Buffer.from("<p>B</p>") },
          ]),
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IMPORT_FAILED",
      }),
    );
  });

  it("rejects HTML ZIP archives with unsafe paths", () => {
    expect(() =>
      readSafeHtmlZipEntries(
        htmlZipFile([
          { fileName: "index.html", content: Buffer.from("<p>Index</p>") },
          { fileName: "../image.png", content: Buffer.from("image") },
        ]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IMPORT_FAILED",
      }),
    );
  });

  it("rejects HTML ZIP archives whose declared uncompressed size is too large", () => {
    expect(() =>
      readSafeHtmlZipEntries(
        htmlZipFile([
          { fileName: "index.html", content: Buffer.from("<p>Index</p>") },
          {
            compressedSize: 1,
            fileName: "image.png",
            uncompressedSize: DocumentMaxImportSizeBytes + 1,
          },
        ]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "FILE_TOO_LARGE",
      }),
    );
  });

  it("rejects HTML ZIP entries whose decompressed size does not match the central directory", () => {
    const file = htmlZipFile([
      {
        compressionMethod: 8,
        content: deflateRawSync(Buffer.from("<p>Index</p>")),
        fileName: "index.html",
        uncompressedSize: 1,
      },
    ]);
    const entry = selectHtmlZipEntry(readSafeHtmlZipEntries(file));

    expect(() => readHtmlZipEntryData(file, entry)).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IMPORT_FAILED",
      }),
    );
  });
});

function docxFile(
  input: Partial<UploadedDocumentFile> = {},
): UploadedDocumentFile {
  return {
    buffer: input.buffer ?? createMinimalDocxZipBuffer(),
    fileName: input.fileName ?? "document.docx",
    mimeType:
      input.mimeType ??
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: input.size ?? input.buffer?.length ?? 1,
  };
}

function createMinimalDocxZipBuffer(): Buffer {
  return createZipBuffer([
    { fileName: "[Content_Types].xml", content: Buffer.from("types") },
    { fileName: "word/document.xml", content: Buffer.from("document") },
  ]);
}

function htmlFile(
  input: Partial<UploadedDocumentFile> = {},
): UploadedDocumentFile {
  return {
    buffer: input.buffer ?? Buffer.from("<h1>HTML</h1>"),
    fileName: input.fileName ?? "document.html",
    mimeType: input.mimeType ?? "text/html",
    size: input.size ?? input.buffer?.length ?? 1,
  };
}

function htmlZipFile(
  entries: Parameters<typeof createZipBuffer>[0],
): UploadedDocumentFile {
  const buffer = createZipBuffer(entries);

  return {
    buffer,
    fileName: "document.zip",
    mimeType: "application/zip",
    size: buffer.length,
  };
}

function createZipBuffer(
  entries: Array<{
    compressionMethod?: number;
    compressedSize?: number;
    content?: Buffer;
    fileName: string;
    uncompressedSize?: number;
  }>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    const compressionMethod = entry.compressionMethod ?? 0;
    const name = Buffer.from(entry.fileName, "utf8");
    const compressedSize = entry.compressedSize ?? content.length;
    const uncompressedSize = entry.uncompressedSize ?? content.length;
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + content.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);

  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localData.length, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDirectory, endOfCentralDirectory]);
}
