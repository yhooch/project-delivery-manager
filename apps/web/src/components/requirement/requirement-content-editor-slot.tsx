"use client";

import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Attachment, AttachmentRef } from "@project-delivery/shared";
import {
  Bold,
  Code2,
  Columns3,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  Quote,
  Redo2,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";

import {
  AttachmentUploadError,
  createAttachmentDownloadUrl,
  uploadRequirementImage,
  type AttachmentUploadErrorCode,
} from "../../lib/attachment-service";
import {
  collectAttachmentImageIds,
  containsBase64Image,
  convertRequirementContentEditorValueFormat,
  createContentEditorValue,
  createEditorValueFromMarkdown,
  createEditorValueFromTiptapJson,
  createTiptapDocumentFromText,
  createTiptapDocumentForEditing,
  isRequirementContentEditorValueEmpty,
  sanitizeTiptapDocument,
  type AttachmentImageDisplayUrls,
  type RequirementContentFormat,
  type RequirementContentEditorValue,
} from "../../lib/requirement-editor-content";
import {
  applyMarkdownEditorCommand,
  insertMarkdownAttachmentImage,
  type MarkdownEditorCommandOptions,
  type MarkdownEditorSelection,
} from "../../lib/requirement-markdown-editor-commands";
import {
  getAttachmentIdFromMarkdownImageSrc,
  parseRequirementMarkdown,
  type RequirementMarkdownBlock,
} from "../../lib/requirement-markdown-content";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export {
  createContentEditorValue,
  createTiptapDocumentFromText,
  type RequirementContentEditorValue,
};

export type RequirementContentEditorSlotProps = {
  attachmentCount?: number;
  canUploadImages?: boolean;
  disabled?: boolean;
  onAttachmentUploaded?: (attachment: AttachmentRef) => void;
  onChange: (value: RequirementContentEditorValue) => void;
  requirementId?: string;
  value: RequirementContentEditorValue;
};

type UploadItem = {
  errorCode?: AttachmentUploadErrorCode;
  file: File;
  id: string;
  retryable: boolean;
  status: "failed" | "uploading";
  target: "markdown" | "tiptap";
};

type LinkDialogState = {
  from: number;
  href: string;
  open: boolean;
  to: number;
};

const RequirementImage = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? { "data-attachment-id": attributes.attachmentId }
            : {},
      },
      fileKey: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-key"),
        renderHTML: (attributes) =>
          attributes.fileKey ? { "data-file-key": attributes.fileKey } : {},
      },
      fileName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-name"),
        renderHTML: (attributes) =>
          attributes.fileName ? { "data-file-name": attributes.fileName } : {},
      },
      mimeType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-mime-type"),
        renderHTML: (attributes) =>
          attributes.mimeType ? { "data-mime-type": attributes.mimeType } : {},
      },
      size: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-size");
          return value ? Number(value) : null;
        },
        renderHTML: (attributes) =>
          attributes.size ? { "data-size": String(attributes.size) } : {},
      },
    };
  },
});

const EMPTY_TIPTAP_DOCUMENT = {
  content: [{ type: "paragraph" }],
  type: "doc",
};

export function RequirementContentEditorSlot({
  attachmentCount = 0,
  canUploadImages = false,
  disabled,
  onAttachmentUploaded,
  onChange,
  requirementId,
  value,
}: RequirementContentEditorSlotProps) {
  const t = useTranslations("requirements.editor");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const [localAttachmentCount, setLocalAttachmentCount] =
    useState(attachmentCount);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [markdownConversionDialogOpen, setMarkdownConversionDialogOpen] =
    useState(false);
  const [imageDisplayUrls, setImageDisplayUrls] = useState<
    Record<string, string>
  >({});
  const imageDisplayUrlsRef = useRef<AttachmentImageDisplayUrls>({});
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>({
    from: 0,
    href: "",
    open: false,
    to: 0,
  });
  const tiptapContentJson =
    value.contentFormat === "TIPTAP_JSON"
      ? value.contentJson
      : EMPTY_TIPTAP_DOCUMENT;
  const normalizedInitialContent = useMemo(
    () => createTiptapDocumentForEditing(tiptapContentJson, imageDisplayUrls),
    [imageDisplayUrls, tiptapContentJson],
  );
  const editor = useEditor({
    content: normalizedInitialContent,
    editorProps: {
      attributes: {
        "aria-label": t("ariaLabel"),
        class: "tiptap-editor__surface",
      },
      handlePaste: (_view, event) => {
        const files = getImageFiles(event.clipboardData?.files);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        void uploadImageFiles(files, "tiptap", insertUploadedImage);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = getImageFiles(event.dataTransfer?.files);

        if (files.length === 0) {
          return false;
        }

        event.preventDefault();
        void uploadImageFiles(files, "tiptap", insertUploadedImage);
        return true;
      },
    },
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: "tiptap-code-block",
          },
        },
        link: false,
      }),
      LinkExtension.configure({
        HTMLAttributes: {
          rel: "noreferrer",
          target: "_blank",
        },
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: t("placeholder"),
      }),
      RequirementImage.configure({
        allowBase64: false,
        HTMLAttributes: {
          class: "tiptap-image",
        },
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      if (valueRef.current.contentFormat !== "TIPTAP_JSON") {
        return;
      }

      const rawContentJson = activeEditor.getJSON();
      const contentJson = sanitizeTiptapDocument(rawContentJson);

      if (containsBase64Image(rawContentJson)) {
        activeEditor.commands.setContent(
          createTiptapDocumentForEditing(
            contentJson,
            imageDisplayUrlsRef.current,
          ),
          { emitUpdate: false },
        );
      }

      onChange(createEditorValueFromTiptapJson(contentJson));
    },
  });

  useEffect(() => {
    setLocalAttachmentCount(attachmentCount);
  }, [attachmentCount]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    imageDisplayUrlsRef.current = imageDisplayUrls;
  }, [imageDisplayUrls]);

  useEffect(() => {
    if (value.contentFormat !== "TIPTAP_JSON") {
      return;
    }

    const attachmentIds = collectAttachmentImageIds(value.contentJson);
    const missingAttachmentIds = attachmentIds.filter(
      (attachmentId) => !imageDisplayUrls[attachmentId],
    );

    if (missingAttachmentIds.length === 0) {
      return;
    }

    setImageDisplayUrls((current) => {
      const next = { ...current };

      missingAttachmentIds.forEach((attachmentId) => {
        next[attachmentId] = createAttachmentDownloadUrl(attachmentId);
      });

      return next;
    });
  }, [imageDisplayUrls, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const hydrated = createTiptapDocumentForEditing(
      editor.getJSON(),
      imageDisplayUrls,
    );

    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(hydrated)) {
      editor.commands.setContent(hydrated, { emitUpdate: false });
    }
  }, [editor, imageDisplayUrls]);

  useEffect(() => {
    if (value.contentFormat !== "TIPTAP_JSON") {
      return;
    }

    if (!editor || editor.isFocused) {
      return;
    }

    const sanitized = createTiptapDocumentForEditing(
      value.contentJson,
      imageDisplayUrls,
    );

    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(sanitized)) {
      editor.commands.setContent(sanitized, { emitUpdate: false });
    }
  }, [editor, imageDisplayUrls, value]);

  function applyLink() {
    if (!editor) {
      return;
    }

    const currentHref = editor.getAttributes("link").href as string | undefined;
    const { from, to } = editor.state.selection;

    setLinkDialog({
      from,
      href: currentHref ?? "",
      open: true,
      to,
    });
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const nextHref = linkDialog.href.trim();
    const chain = editor
      .chain()
      .focus()
      .setTextSelection({ from: linkDialog.from, to: linkDialog.to })
      .extendMarkRange("link");

    if (nextHref.length === 0) {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href: nextHref }).run();
    }

    setLinkDialog((current) => ({
      ...current,
      href: "",
      open: false,
    }));
  }

  async function uploadImageFiles(
    files: File[],
    target: UploadItem["target"],
    onUploaded: (attachment: Attachment, imageUrl: string) => void,
  ) {
    if (disabled) {
      return;
    }

    if (!canUploadImages || !requirementId) {
      setUploads((current) => [
        ...current,
        ...files.map((file) =>
          createFailedUpload(file, "DRAFT_REQUIRED", target),
        ),
      ]);
      return;
    }

    let nextAttachmentCount = localAttachmentCount;

    for (const file of files) {
      const item = createUploadingItem(file, target);
      setUploads((current) => [...current, item]);

      try {
        const result = await uploadRequirementImage({
          existingAttachmentCount: nextAttachmentCount,
          file,
          requirementId,
        });
        nextAttachmentCount += 1;
        setLocalAttachmentCount(nextAttachmentCount);
        setImageDisplayUrls((current) => ({
          ...current,
          [result.attachment.id]: result.imageUrl,
        }));
        onUploaded(result.attachment, result.imageUrl);
        onAttachmentUploaded?.(toAttachmentRef(result.attachment));
        setUploads((current) =>
          current.filter((upload) => upload.id !== item.id),
        );
      } catch (error) {
        const mapped = toUploadError(error);
        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id
              ? {
                  ...upload,
                  errorCode: mapped.code,
                  retryable: mapped.retryable,
                  status: "failed",
                }
              : upload,
          ),
        );
      }
    }
  }

  async function retryUpload(
    item: UploadItem,
    onUploaded: (attachment: Attachment, imageUrl: string) => void,
  ) {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === item.id
          ? {
              ...upload,
              errorCode: undefined,
              retryable: false,
              status: "uploading",
            }
          : upload,
      ),
    );

    if (!requirementId) {
      setUploads((current) =>
        current.map((upload) =>
          upload.id === item.id
            ? {
                ...upload,
                errorCode: "DRAFT_REQUIRED",
                retryable: false,
                status: "failed",
              }
            : upload,
        ),
      );
      return;
    }

    try {
      const result = await uploadRequirementImage({
        existingAttachmentCount: localAttachmentCount,
        file: item.file,
        requirementId,
      });
      setLocalAttachmentCount((current) => current + 1);
      setImageDisplayUrls((current) => ({
        ...current,
        [result.attachment.id]: result.imageUrl,
      }));
      onUploaded(result.attachment, result.imageUrl);
      onAttachmentUploaded?.(toAttachmentRef(result.attachment));
      setUploads((current) =>
        current.filter((upload) => upload.id !== item.id),
      );
    } catch (error) {
      const mapped = toUploadError(error);
      setUploads((current) =>
        current.map((upload) =>
          upload.id === item.id
            ? {
                ...upload,
                errorCode: mapped.code,
                retryable: mapped.retryable,
                status: "failed",
              }
            : upload,
        ),
      );
    }
  }

  function insertUploadedImage(attachment: Attachment, imageUrl: string) {
    editor
      ?.chain()
      .focus()
      .insertContent({
        attrs: {
          alt: attachment.fileName,
          attachmentId: attachment.id,
          fileKey: attachment.fileKey,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          src: imageUrl,
          title: attachment.fileName,
        },
        type: "image",
      })
      .run();
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void uploadImageFiles(files, "tiptap", insertUploadedImage);
  }

  function onContentFormatChange(nextFormat: RequirementContentFormat) {
    if (
      value.contentFormat === "MARKDOWN" &&
      nextFormat === "TIPTAP_JSON" &&
      !isRequirementContentEditorValueEmpty(value)
    ) {
      setMarkdownConversionDialogOpen(true);
      return;
    }

    commitContentFormatChange(nextFormat);
  }

  function commitContentFormatChange(nextFormat: RequirementContentFormat) {
    const result = convertRequirementContentEditorValueFormat(
      value,
      nextFormat,
    );

    onChange(result.value);
  }

  function confirmMarkdownConversion() {
    setMarkdownConversionDialogOpen(false);
    commitContentFormatChange("TIPTAP_JSON");
  }

  if (value.contentFormat === "MARKDOWN") {
    return (
      <RequirementMarkdownEditor
        canUploadImages={canUploadImages}
        disabled={disabled}
        imageDisplayUrls={imageDisplayUrls}
        markdownConversionDialogOpen={markdownConversionDialogOpen}
        onChange={onChange}
        onConfirmMarkdownConversion={confirmMarkdownConversion}
        onFormatChange={onContentFormatChange}
        onMarkdownConversionDialogOpenChange={setMarkdownConversionDialogOpen}
        onRetryUpload={retryUpload}
        onUploadImages={(files, onUploaded) =>
          uploadImageFiles(files, "markdown", onUploaded)
        }
        uploads={uploads.filter((item) => item.target === "markdown")}
        value={value.contentMarkdown}
      />
    );
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="requirement-editor-title"
    >
      <div className="flex flex-col gap-0.5">
        <h3
          id="requirement-editor-title"
          className="text-sm font-semibold text-foreground"
        >
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="flex flex-col gap-2" aria-busy={isUploading(uploads)}>
        <div
          className="flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1"
          role="toolbar"
          aria-label={t("toolbarLabel")}
        >
          <ToolbarButton
            active={editor?.isActive("bold") ?? false}
            disabled={!editor || disabled}
            icon={Bold}
            label={t("toolbar.bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            active={editor?.isActive("italic") ?? false}
            disabled={!editor || disabled}
            icon={Italic}
            label={t("toolbar.italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            active={editor?.isActive("strike") ?? false}
            disabled={!editor || disabled}
            icon={Strikethrough}
            label={t("toolbar.strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />
          <ToolbarDivider />
          <ToolbarButton
            active={editor?.isActive("bulletList") ?? false}
            disabled={!editor || disabled}
            icon={List}
            label={t("toolbar.bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            active={editor?.isActive("orderedList") ?? false}
            disabled={!editor || disabled}
            icon={ListOrdered}
            label={t("toolbar.orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            active={editor?.isActive("taskList") ?? false}
            disabled={!editor || disabled}
            icon={ListTodo}
            label={t("toolbar.taskList")}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          />
          <ToolbarDivider />
          <ToolbarButton
            active={editor?.isActive("codeBlock") ?? false}
            disabled={!editor || disabled}
            icon={Code2}
            label={t("toolbar.codeBlock")}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          />
          <ToolbarButton
            active={editor?.isActive("blockquote") ?? false}
            disabled={!editor || disabled}
            icon={Quote}
            label={t("toolbar.blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            active={editor?.isActive("link") ?? false}
            disabled={!editor || disabled}
            icon={Link2}
            label={t("toolbar.link")}
            onClick={applyLink}
          />
          <ToolbarDivider />
          <ToolbarButton
            disabled={!editor || disabled}
            icon={Table2}
            label={t("toolbar.insertTable")}
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
                .run()
            }
          />
          <ToolbarButton
            disabled={!editor || disabled || !editor.can().addColumnAfter()}
            icon={Columns3}
            label={t("toolbar.addColumn")}
            onClick={() => editor?.chain().focus().addColumnAfter().run()}
          />
          <ToolbarButton
            disabled={!editor || disabled || !editor.can().addRowAfter()}
            icon={Rows3}
            label={t("toolbar.addRow")}
            onClick={() => editor?.chain().focus().addRowAfter().run()}
          />
          <ToolbarButton
            disabled={!editor || disabled || !editor.can().deleteTable()}
            icon={Trash2}
            label={t("toolbar.deleteTable")}
            onClick={() => editor?.chain().focus().deleteTable().run()}
          />
          <ToolbarDivider />
          <ToolbarButton
            disabled={!editor || disabled || !canUploadImages}
            icon={ImagePlus}
            label={t("toolbar.uploadImage")}
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolbarDivider />
          <ToolbarButton
            disabled={!editor || disabled || !editor.can().undo()}
            icon={Undo2}
            label={t("toolbar.undo")}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <ToolbarButton
            disabled={!editor || disabled || !editor.can().redo()}
            icon={Redo2}
            label={t("toolbar.redo")}
            onClick={() => editor?.chain().focus().redo().run()}
          />
          <ToolbarDivider />
          <ContentFormatSelector
            disabled={disabled}
            onChange={onContentFormatChange}
            value={value.contentFormat}
          />
        </div>
        <input
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          className="sr-only"
          disabled={disabled || !canUploadImages}
          onChange={onFileInputChange}
          ref={fileInputRef}
          type="file"
        />
        <EditorContent
          className="tiptap-editor resize-y overflow-auto"
          editor={editor}
        />
      </div>
      <Dialog
        open={linkDialog.open}
        onOpenChange={(open) =>
          setLinkDialog((current) => ({
            ...current,
            open,
          }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("linkPrompt")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("linkPrompt")}
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={submitLink}>
            <Input
              aria-label={t("linkPrompt")}
              autoFocus
              onChange={(event) =>
                setLinkDialog((current) => ({
                  ...current,
                  href: event.target.value,
                }))
              }
              placeholder={t("linkPlaceholder")}
              value={linkDialog.href}
            />
            <DialogFooter>
              <Button type="submit">{t("toolbar.link")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {!canUploadImages && !disabled ? (
        <p className="text-xs text-muted-foreground">{t("draftUploadOnly")}</p>
      ) : null}
      <UploadList
        onRetry={(item) => void retryUpload(item, insertUploadedImage)}
        uploads={uploads.filter((item) => item.target === "tiptap")}
      />
    </section>
  );
}

function RequirementMarkdownEditor({
  canUploadImages,
  disabled,
  imageDisplayUrls,
  markdownConversionDialogOpen,
  onChange,
  onConfirmMarkdownConversion,
  onFormatChange,
  onMarkdownConversionDialogOpenChange,
  onRetryUpload,
  onUploadImages,
  uploads,
  value,
}: {
  canUploadImages: boolean;
  disabled?: boolean;
  imageDisplayUrls: Record<string, string>;
  markdownConversionDialogOpen: boolean;
  onChange: (value: RequirementContentEditorValue) => void;
  onConfirmMarkdownConversion: () => void;
  onFormatChange: (format: RequirementContentFormat) => void;
  onMarkdownConversionDialogOpenChange: (open: boolean) => void;
  onRetryUpload: (
    item: UploadItem,
    onUploaded: (attachment: Attachment, imageUrl: string) => void,
  ) => void;
  onUploadImages: (
    files: File[],
    onUploaded: (attachment: Attachment, imageUrl: string) => void,
  ) => void;
  uploads: UploadItem[];
  value: string;
}) {
  const t = useTranslations("requirements.editor");
  const markdownFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    end: 0,
    start: 0,
  });
  const [markdownLinkDialog, setMarkdownLinkDialog] = useState({
    href: "",
    open: false,
  });
  const markdownCommandOptions = useMemo<MarkdownEditorCommandOptions>(
    () => ({
      boldPlaceholder: t("markdownCommands.boldPlaceholder"),
      codeBlockPlaceholder: t("markdownCommands.codeBlockPlaceholder"),
      italicPlaceholder: t("markdownCommands.italicPlaceholder"),
      linkLabel: t("markdownCommands.linkLabel"),
      tableTemplate: [
        `| ${t("markdownCommands.table.column1")} | ${t("markdownCommands.table.column2")} | ${t("markdownCommands.table.column3")} |`,
        "| --- | --- | --- |",
        `| ${t("markdownCommands.table.cell")} | ${t("markdownCommands.table.cell")} | ${t("markdownCommands.table.cell")} |`,
      ].join("\n"),
    }),
    [t],
  );

  function captureSelection() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return selection;
    }

    const nextSelection = {
      end: textarea.selectionEnd,
      start: textarea.selectionStart,
    };

    setSelection(nextSelection);
    return nextSelection;
  }

  function updateMarkdownValue(nextValue: string) {
    onChange(createEditorValueFromMarkdown(nextValue));
  }

  function applyCommand(
    command: Parameters<typeof applyMarkdownEditorCommand>[0]["command"],
  ) {
    const result = applyMarkdownEditorCommand({
      command,
      options: markdownCommandOptions,
      selection: captureSelection(),
      value,
    });

    updateMarkdownValue(result.value);
    focusTextareaSelection(result.selection);
  }

  function focusTextareaSelection(nextSelection: MarkdownEditorSelection) {
    const requestFrame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(Date.now()), 0);

    requestFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextSelection.start, nextSelection.end);
      setSelection(nextSelection);
    });
  }

  function submitMarkdownLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const href = markdownLinkDialog.href.trim();

    if (href.length > 0) {
      applyCommand({ href, type: "link" });
    }

    setMarkdownLinkDialog({ href: "", open: false });
  }

  function insertMarkdownImage(attachment: Attachment) {
    const result = insertMarkdownAttachmentImage({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      selection: captureSelection(),
      value,
    });

    updateMarkdownValue(result.value);
    focusTextareaSelection(result.selection);
  }

  function uploadMarkdownImages(files: File[]) {
    const imageFiles = getImageFiles(files);

    if (imageFiles.length === 0) {
      return;
    }

    onUploadImages(imageFiles, insertMarkdownImage);
  }

  function onMarkdownPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = getImageFiles(event.clipboardData?.files);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    uploadMarkdownImages(files);
  }

  function onMarkdownDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = getImageFiles(event.dataTransfer?.files);

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    uploadMarkdownImages(files);
  }

  if (disabled) {
    return (
      <section
        className="flex flex-col gap-3"
        aria-labelledby="requirement-editor-title"
      >
        <div className="flex flex-col gap-0.5">
          <h3
            id="requirement-editor-title"
            className="text-sm font-semibold text-foreground"
          >
            {t("title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <RequirementMarkdownPreview
          imageDisplayUrls={imageDisplayUrls}
          markdown={value}
        />
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="requirement-editor-title"
    >
      <div className="flex flex-col gap-0.5">
        <h3
          id="requirement-editor-title"
          className="text-sm font-semibold text-foreground"
        >
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1"
        role="toolbar"
        aria-label={t("toolbarLabel")}
      >
        <ToolbarButton
          disabled={disabled}
          icon={Heading2}
          label={t("toolbar.heading")}
          onClick={() => applyCommand({ level: 2, type: "heading" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={Bold}
          label={t("toolbar.bold")}
          onClick={() => applyCommand({ type: "bold" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={Italic}
          label={t("toolbar.italic")}
          onClick={() => applyCommand({ type: "italic" })}
        />
        <ToolbarDivider />
        <ToolbarButton
          disabled={disabled}
          icon={List}
          label={t("toolbar.bulletList")}
          onClick={() => applyCommand({ type: "bulletList" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={ListOrdered}
          label={t("toolbar.orderedList")}
          onClick={() => applyCommand({ type: "orderedList" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={ListTodo}
          label={t("toolbar.taskList")}
          onClick={() => applyCommand({ type: "taskList" })}
        />
        <ToolbarDivider />
        <ToolbarButton
          disabled={disabled}
          icon={Quote}
          label={t("toolbar.blockquote")}
          onClick={() => applyCommand({ type: "blockquote" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={Code2}
          label={t("toolbar.codeBlock")}
          onClick={() => applyCommand({ type: "codeBlock" })}
        />
        <ToolbarButton
          disabled={disabled}
          icon={Link2}
          label={t("toolbar.link")}
          onClick={() => {
            captureSelection();
            setMarkdownLinkDialog({ href: "", open: true });
          }}
        />
        <ToolbarButton
          disabled={disabled}
          icon={Table2}
          label={t("toolbar.insertTable")}
          onClick={() => applyCommand({ type: "table" })}
        />
        <ToolbarButton
          disabled={disabled || !canUploadImages}
          icon={ImagePlus}
          label={t("toolbar.uploadImage")}
          onClick={() => markdownFileInputRef.current?.click()}
        />
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <div
            aria-label={t("markdownViewMode.label")}
            className="inline-flex h-7 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background"
            role="group"
          >
            <MarkdownViewModeButton
              label={t("markdownViewMode.edit")}
              onClick={() => setViewMode("edit")}
              selected={viewMode === "edit"}
            />
            <MarkdownViewModeButton
              label={t("markdownViewMode.preview")}
              onClick={() => setViewMode("preview")}
              selected={viewMode === "preview"}
            />
          </div>
          <ContentFormatSelector
            className=""
            disabled={disabled}
            onChange={onFormatChange}
            value="MARKDOWN"
          />
        </div>
      </div>

      {viewMode === "preview" ? (
        <RequirementMarkdownPreview
          imageDisplayUrls={imageDisplayUrls}
          markdown={value}
        />
      ) : (
        <textarea
          aria-label={t("ariaLabel")}
          className={cn(
            "min-h-[18rem] w-full resize-y rounded-md border border-border/60 bg-background/60 px-3 py-2",
            "font-mono text-sm leading-6 text-foreground outline-none",
            "placeholder:text-muted-foreground/50",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          onChange={(event) =>
            onChange(createEditorValueFromMarkdown(event.target.value))
          }
          onClick={captureSelection}
          onDrop={onMarkdownDrop}
          onKeyUp={captureSelection}
          onPaste={onMarkdownPaste}
          onSelect={captureSelection}
          placeholder={t("placeholder")}
          ref={textareaRef}
          value={value}
        />
      )}
      <input
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="sr-only"
        disabled={disabled || !canUploadImages}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          uploadMarkdownImages(files);
        }}
        ref={markdownFileInputRef}
        type="file"
      />
      <Dialog
        open={markdownLinkDialog.open}
        onOpenChange={(open) =>
          setMarkdownLinkDialog((current) => ({
            ...current,
            open,
          }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("linkPrompt")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("linkPrompt")}
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={submitMarkdownLink}>
            <Input
              aria-label={t("linkPrompt")}
              autoFocus
              onChange={(event) =>
                setMarkdownLinkDialog((current) => ({
                  ...current,
                  href: event.target.value,
                }))
              }
              placeholder={t("linkPlaceholder")}
              value={markdownLinkDialog.href}
            />
            <DialogFooter>
              <Button type="submit">{t("toolbar.link")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {!canUploadImages ? (
        <p className="text-xs text-muted-foreground">{t("draftUploadOnly")}</p>
      ) : null}
      <UploadList
        onRetry={(item) => void onRetryUpload(item, insertMarkdownImage)}
        uploads={uploads}
      />
      <Dialog
        open={markdownConversionDialogOpen}
        onOpenChange={onMarkdownConversionDialogOpenChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("markdownConvertDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("markdownConvertDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => onMarkdownConversionDialogOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("markdownConvertDialog.cancel")}
            </Button>
            <Button onClick={onConfirmMarkdownConversion} type="button">
              {t("markdownConvertDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ContentFormatSelector({
  className = "ml-auto",
  disabled,
  onChange,
  value,
}: {
  className?: string;
  disabled?: boolean;
  onChange: (format: RequirementContentFormat) => void;
  value: RequirementContentFormat;
}) {
  const t = useTranslations("requirements.editor");
  const options: Array<{
    label: string;
    value: RequirementContentFormat;
  }> = [
    { label: t("contentFormat.richText"), value: "TIPTAP_JSON" },
    { label: t("contentFormat.markdown"), value: "MARKDOWN" },
  ];

  return (
    <div className={cn(className, "flex items-center px-1")}>
      <div
        aria-label={options.map((option) => option.label).join(" / ")}
        className="inline-flex h-7 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background"
        role="group"
      >
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <button
              aria-pressed={selected}
              className={cn(
                "min-w-14 px-2 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
              disabled={disabled}
              key={option.value}
              onClick={() => {
                if (!selected) {
                  onChange(option.value);
                }
              }}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UploadList({
  onRetry,
  uploads,
}: {
  onRetry: (item: UploadItem) => void;
  uploads: UploadItem[];
}) {
  const t = useTranslations("requirements.editor");
  const hasUploadError = uploads.some((item) => item.status === "failed");

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card px-3 py-2",
        hasUploadError
          ? "border-destructive/40 bg-destructive/5"
          : "border-border/60",
      )}
      aria-live="polite"
    >
      {uploads.map((item) => (
        <div className="flex items-center gap-3 text-sm" key={item.id}>
          <div
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              item.status === "uploading"
                ? "bg-muted text-muted-foreground"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {item.status === "uploading" ? (
              <Loader2
                aria-hidden="true"
                className="animate-spin"
                size={16}
                strokeWidth={2}
              />
            ) : (
              <XCircle aria-hidden="true" size={16} strokeWidth={2} />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="truncate text-sm font-medium text-foreground">
              {item.file.name || t("unknownFile")}
            </strong>
            <span className="text-xs text-muted-foreground">
              {item.status === "uploading"
                ? t("uploading")
                : t(`uploadErrors.${item.errorCode ?? "UPLOAD_FAILED"}`)}
            </span>
          </div>
          {item.status === "failed" && item.retryable ? (
            <Button
              onClick={() => onRetry(item)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RequirementMarkdownPreview({
  imageDisplayUrls,
  markdown,
}: {
  imageDisplayUrls: Record<string, string>;
  markdown: string;
}) {
  const blocks = useMemo(() => parseRequirementMarkdown(markdown), [markdown]);
  const [resolvedImageUrls, setResolvedImageUrls] =
    useState<Record<string, string>>(imageDisplayUrls);

  useEffect(() => {
    if (Object.keys(imageDisplayUrls).length === 0) {
      return;
    }

    setResolvedImageUrls((current) => ({
      ...current,
      ...imageDisplayUrls,
    }));
  }, [imageDisplayUrls]);

  useEffect(() => {
    const attachmentIds = blocks
      .filter(
        (
          block,
        ): block is Extract<RequirementMarkdownBlock, { type: "image" }> =>
          block.type === "image",
      )
      .map((block) => getAttachmentIdFromMarkdownImageSrc(block.src))
      .filter((id): id is string => Boolean(id));
    const missingAttachmentIds = Array.from(new Set(attachmentIds)).filter(
      (attachmentId) => !resolvedImageUrls[attachmentId],
    );

    if (missingAttachmentIds.length === 0) {
      return;
    }

    setResolvedImageUrls((current) => {
      const next = { ...current };

      missingAttachmentIds.forEach((attachmentId) => {
        next[attachmentId] = createAttachmentDownloadUrl(attachmentId);
      });

      return next;
    });
  }, [blocks, resolvedImageUrls]);

  if (blocks.length === 0) {
    return <div className="min-h-24 rounded-md bg-muted/20" />;
  }

  return (
    <div className="flex min-h-24 flex-col gap-3 rounded-md bg-muted/20 px-3 py-3 text-sm leading-6 text-foreground">
      {blocks.map((block, index) =>
        renderMarkdownBlock(block, index, resolvedImageUrls),
      )}
    </div>
  );
}

function renderMarkdownBlock(
  block: RequirementMarkdownBlock,
  index: number,
  imageDisplayUrls: Record<string, string>,
) {
  switch (block.type) {
    case "heading":
      return renderMarkdownHeading(block, index);
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap" key={index}>
          {block.text}
        </p>
      );
    case "blockquote":
      return (
        <blockquote
          className="whitespace-pre-wrap border-l-2 border-border pl-3 text-muted-foreground"
          key={index}
        >
          {block.text}
        </blockquote>
      );
    case "code":
      return (
        <pre
          className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5"
          key={index}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5" key={index}>
          {block.items.map((item, itemIndex) => (
            <li className="pl-1" key={itemIndex}>
              {item.text}
            </li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-1 pl-1" key={index}>
          {block.items.map((item, itemIndex) => (
            <li className="flex items-start gap-2" key={itemIndex}>
              {typeof item.checked === "boolean" ? (
                <input
                  checked={item.checked}
                  className="mt-1 h-3.5 w-3.5"
                  disabled
                  readOnly
                  type="checkbox"
                />
              ) : (
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
              )}
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      );
    case "image":
      return renderMarkdownImageBlock(block, index, imageDisplayUrls);
    case "horizontalRule":
      return <hr className="border-border" key={index} />;
  }
}

function renderMarkdownImageBlock(
  block: Extract<RequirementMarkdownBlock, { type: "image" }>,
  index: number,
  imageDisplayUrls: Record<string, string>,
) {
  const attachmentId = getAttachmentIdFromMarkdownImageSrc(block.src);
  const imageUrl = attachmentId ? imageDisplayUrls[attachmentId] : undefined;

  if (imageUrl) {
    return (
      <img
        alt={block.alt}
        className="max-h-80 max-w-full rounded-md border border-border/60 object-contain"
        key={index}
        src={imageUrl}
      />
    );
  }

  return (
    <div
      className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
      key={index}
    >
      {block.alt || block.src}
    </div>
  );
}

function renderMarkdownHeading(
  block: Extract<RequirementMarkdownBlock, { type: "heading" }>,
  index: number,
) {
  const className =
    block.level <= 2
      ? "text-lg font-semibold leading-7"
      : "text-base font-semibold leading-6";

  if (block.level === 1) {
    return (
      <h2 className={className} key={index}>
        {block.text}
      </h2>
    );
  }

  if (block.level === 2) {
    return (
      <h3 className={className} key={index}>
        {block.text}
      </h3>
    );
  }

  return (
    <h4 className={className} key={index}>
      {block.text}
    </h4>
  );
}

function MarkdownViewModeButton({
  label,
  onClick,
  selected,
}: {
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 min-w-12 items-center justify-center px-2 text-xs font-medium text-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "bg-muted text-foreground"
          : "hover:bg-muted/70 hover:text-foreground",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "h-7 w-7 text-muted-foreground hover:text-foreground",
        active && "bg-accent text-accent-foreground hover:bg-accent",
      )}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={2} />
    </Button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />;
}

function createUploadingItem(
  file: File,
  target: UploadItem["target"],
): UploadItem {
  return {
    file,
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    retryable: false,
    status: "uploading",
    target,
  };
}

function getImageFiles(fileList: FileList | File[] | null | undefined): File[] {
  return Array.from(fileList ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

function createFailedUpload(
  file: File,
  code: AttachmentUploadErrorCode,
  target: UploadItem["target"],
): UploadItem {
  return {
    file,
    errorCode: code,
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    retryable: false,
    status: "failed",
    target,
  };
}

function isUploading(uploads: UploadItem[]): boolean {
  return uploads.some((item) => item.status === "uploading");
}

function toUploadError(error: unknown): AttachmentUploadError {
  return error instanceof AttachmentUploadError
    ? error
    : new AttachmentUploadError("UPLOAD_FAILED", true);
}

function toAttachmentRef(attachment: Attachment): AttachmentRef {
  return {
    fileKey: attachment.fileKey,
    fileName: attachment.fileName,
    id: attachment.id,
    mimeType: attachment.mimeType,
    previewUrl: attachment.previewUrl,
    size: attachment.size,
  };
}
