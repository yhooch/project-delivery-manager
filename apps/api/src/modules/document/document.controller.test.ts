import {
  BadRequestException,
  HttpStatus,
  PayloadTooLargeException,
} from "@nestjs/common";
import {
  DocumentMaxImportSizeBytes,
  ImportMarkdownDocumentRequestSchema,
} from "@project-delivery/shared";
import { describe, expect, it } from "vitest";

import { ApiException } from "../../http/api-exception";
import {
  documentImportMulterOptions,
  mapDocumentImportUploadException,
  parseMultipartMetadata,
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

  it("maps multipart metadata schema failures to VALIDATION_ERROR details", () => {
    expect(() =>
      parseMultipartMetadata(
        {
          title: "",
        },
        ImportMarkdownDocumentRequestSchema,
      ),
    ).toThrow(ApiException);

    try {
      parseMultipartMetadata(
        {
          title: "",
        },
        ImportMarkdownDocumentRequestSchema,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe("VALIDATION_ERROR");
      expect((error as ApiException).getStatus()).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect((error as ApiException).details).toEqual({
        issues: [
          expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String),
            path: ["title"],
          }),
        ],
      });
    }
  });

  it("maps multer file count limits to VALIDATION_ERROR ApiException", () => {
    const mapped = mapDocumentImportUploadException(
      new BadRequestException("Too many files"),
    );

    expect(mapped).toBeInstanceOf(ApiException);
    expect(mapped).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Too many files",
    });
    expect((mapped as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it("maps multer unexpected fields to VALIDATION_ERROR ApiException", () => {
    const mapped = mapDocumentImportUploadException(
      new BadRequestException("Unexpected field - attachment"),
    );

    expect(mapped).toBeInstanceOf(ApiException);
    expect(mapped).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Unexpected field - attachment",
    });
    expect((mapped as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it("maps invalid multipart JSON fields to VALIDATION_ERROR details", () => {
    expect(() =>
      parseMultipartMetadata(
        {
          tagIds: "[",
          title: "Valid title",
        },
        ImportMarkdownDocumentRequestSchema,
      ),
    ).toThrow(ApiException);

    try {
      parseMultipartMetadata(
        {
          tagIds: "[",
          title: "Valid title",
        },
        ImportMarkdownDocumentRequestSchema,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe("VALIDATION_ERROR");
      expect((error as ApiException).getStatus()).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect((error as ApiException).details).toEqual({
        issues: [
          {
            code: "invalid_json",
            message: "Multipart JSON field is invalid",
            path: ["tagIds"],
          },
        ],
      });
    }
  });
});
