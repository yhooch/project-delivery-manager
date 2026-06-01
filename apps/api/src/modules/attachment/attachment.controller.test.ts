import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { RequestWithContext } from "../../http/request-context";
import type { CurrentUserService } from "../auth/current-user.service";
import type { AttachmentService } from "./attachment.service";
import {
  AttachmentController,
  formatAttachmentDownloadContentType,
} from "./attachment.controller";

describe("AttachmentController", () => {
  it("marks text attachment downloads as UTF-8 for browser preview", async () => {
    const { attachments, controller, currentUser, response } =
      createControllerFixture("text/markdown");

    await controller.download(
      { attachmentId: "01KSQ7RHSK4AXVHFE6WJD4G6PE" },
      {} as RequestWithContext,
      response,
    );

    expect(currentUser.requireSession).toHaveBeenCalled();
    expect(attachments.download).toHaveBeenCalledWith(
      "01H0000000000000000000001",
      "01KSQ7RHSK4AXVHFE6WJD4G6PE",
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename*=UTF-8''spec.md",
    );
    expect(response.body).toEqual(Buffer.from("# 标题", "utf8"));
  });

  it("keeps binary attachment content types unchanged", async () => {
    const { controller, response } = createControllerFixture("application/pdf");

    await controller.download(
      { attachmentId: "01KSQ7RHSK4AXVHFE6WJD4G6PE" },
      {} as RequestWithContext,
      response,
    );

    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("does not duplicate an existing charset", () => {
    expect(formatAttachmentDownloadContentType("text/plain; charset=utf-8")).toBe(
      "text/plain; charset=utf-8",
    );
  });
});

function createControllerFixture(mimeType: string) {
  const attachment = {
    createdAt: "2026-06-01T00:00:00.000Z",
    fileKey: "attachments/document/01KSQ7RHSK4AXVHFE6WJD4G6PD/spec.md",
    fileName: "spec.md",
    id: "01KSQ7RHSK4AXVHFE6WJD4G6PE",
    mimeType,
    organizationId: "01H0000000000000000000002",
    spaceId: "01H0000000000000000000003",
    size: 8,
    targetId: "01KSQ7RHSK4AXVHFE6WJD4G6PD",
    targetType: "DOCUMENT",
    uploadedById: "01H0000000000000000000001",
  };
  const attachments = {
    download: vi.fn().mockResolvedValue({
      attachment,
      body: Buffer.from("# 标题", "utf8"),
      mimeType,
      size: Buffer.byteLength("# 标题", "utf8"),
    }),
  };
  const currentUser = {
    requireSession: vi.fn().mockReturnValue({
      userId: "01H0000000000000000000001",
    }),
  };
  const response = createResponseFixture();
  const controller = new AttachmentController(
    attachments as unknown as AttachmentService,
    currentUser as unknown as CurrentUserService,
  );

  return { attachments, controller, currentUser, response };
}

function createResponseFixture() {
  const response = {
    body: undefined as Buffer | undefined,
    headers: new Map<string, string | number>(),
    end: vi.fn((body: Buffer) => {
      response.body = body;
    }),
    setHeader: vi.fn((name: string, value: string | number) => {
      response.headers.set(name, value);
    }),
    status: vi.fn(() => response),
  };

  return response;
}
