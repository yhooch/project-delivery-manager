import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { DocumentMaxImportSizeBytes } from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import { ApiException } from "../../http/api-exception";
import {
  documentImportMulterOptions,
  mapDocumentImportUploadException,
} from "./document.controller";

describe("DocumentController upload safeguards", () => {
  it("configures multer file size and file count limits for imports", () => {
    expect(documentImportMulterOptions).toEqual({
      limits: {
        fileSize: DocumentMaxImportSizeBytes + 1,
        files: 1,
      },
    });
  });

  it("maps multer file size limits to FILE_TOO_LARGE ApiException", () => {
    const mapped = mapDocumentImportUploadException(
      new PayloadTooLargeException("File too large"),
    );

    expect(mapped).toBeInstanceOf(ApiException);
    expect(mapped).toMatchObject({
      code: "FILE_TOO_LARGE",
      message: "File is too large",
    });
  });

  it("maps multer file count limits to FILE_TOO_LARGE ApiException", () => {
    const mapped = mapDocumentImportUploadException(
      new BadRequestException("Too many files"),
    );

    expect(mapped).toBeInstanceOf(ApiException);
    expect(mapped).toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });
});
