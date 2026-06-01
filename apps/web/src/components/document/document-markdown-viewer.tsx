"use client";

import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "../../i18n/routing";
import {
  getMarkdownHeadings,
  parseMarkdown,
  type MarkdownHeading,
  type MarkdownInlineToken,
} from "../../lib/document-markdown";
import { getObjectCodeLookupHref } from "../../lib/document-view-model";
import { lookupObjectCode } from "../../lib/object-code-service";
import { cn } from "../../lib/utils";

export type { MarkdownHeading };

type DocumentMarkdownViewerProps = {
  className?: string;
  markdown: string;
  organizationId?: string;
  spaceId?: string;
};

const DOCUMENT_MARKDOWN_HEADING_SCROLL_MARGIN_CLASS = "scroll-mt-28";
const DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS = "max-w-full break-words";

export function DocumentMarkdownViewer({
  className,
  markdown,
  organizationId,
  spaceId,
}: DocumentMarkdownViewerProps) {
  const blocks = parseMarkdown(markdown);
  const t = useTranslations("documents.markdown");

  if (blocks.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
        data-testid="document-markdown-empty"
      >
        {t("empty")}
      </div>
    );
  }

  return (
    <article
      className={cn(
        "document-markdown w-full min-w-0 text-sm leading-7 text-foreground",
        className,
      )}
      data-testid="document-markdown-viewer"
    >
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const HeadingTag = `h${block.level}` as
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6";
          return (
            <HeadingTag
              key={`${block.id}-${index}`}
              id={block.id}
              className={cn(
                DOCUMENT_MARKDOWN_HEADING_SCROLL_MARGIN_CLASS,
                DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS,
                "font-semibold tracking-normal text-foreground",
                block.level === 1 && "mb-3 mt-2 text-2xl leading-9",
                block.level === 2 && "mb-2 mt-8 text-xl leading-8",
                block.level === 3 && "mb-2 mt-6 text-base leading-7",
                block.level >= 4 && "mb-1 mt-5 text-sm leading-6",
              )}
            >
              <InlineTokens
                organizationId={organizationId}
                spaceId={spaceId}
                tokens={block.inlines}
              />
            </HeadingTag>
          );
        }

        if (block.kind === "paragraph") {
          return (
            <p
              key={index}
              className={cn("my-3", DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS)}
            >
              <InlineTokens
                organizationId={organizationId}
                spaceId={spaceId}
                tokens={block.inlines}
              />
            </p>
          );
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={index}
              className={cn(
                "my-4 border-l-2 border-border pl-4 text-muted-foreground",
                DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS,
              )}
            >
              <InlineTokens
                organizationId={organizationId}
                spaceId={spaceId}
                tokens={block.inlines}
              />
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <pre
              key={index}
              className="my-4 w-full overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-xs leading-6 text-foreground"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              className={cn(
                "my-3 space-y-1 pl-5",
                DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS,
                block.ordered ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineTokens
                    organizationId={organizationId}
                    spaceId={spaceId}
                    tokens={item}
                  />
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.kind === "table") {
          return (
            <div key={index} className="my-4 w-full overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 font-semibold text-foreground"
                      >
                        <InlineTokens
                          organizationId={organizationId}
                          spaceId={spaceId}
                          tokens={cell}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-b border-border last:border-0"
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="px-3 py-2 align-top text-muted-foreground"
                        >
                          <InlineTokens
                            organizationId={organizationId}
                            spaceId={spaceId}
                            tokens={cell}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <hr
            key={index}
            className={cn(
              "my-6 border-border",
              DOCUMENT_MARKDOWN_PROSE_WIDTH_CLASS,
            )}
          />
        );
      })}
    </article>
  );
}

export function getDocumentMarkdownHeadings(markdown: string) {
  return getMarkdownHeadings(markdown);
}

function InlineTokens({
  organizationId,
  spaceId,
  tokens,
}: {
  organizationId?: string;
  spaceId?: string;
  tokens: MarkdownInlineToken[];
}) {
  return (
    <>
      {tokens.map((token, index) => (
        <InlineToken
          key={index}
          organizationId={organizationId}
          spaceId={spaceId}
          token={token}
        />
      ))}
    </>
  );
}

function InlineToken({
  organizationId,
  spaceId,
  token,
}: {
  organizationId?: string;
  spaceId?: string;
  token: MarkdownInlineToken;
}) {
  const t = useTranslations("documents.markdown");

  if (token.kind === "text") {
    return <>{token.text}</>;
  }
  if (token.kind === "strong") {
    return <strong className="font-semibold">{token.text}</strong>;
  }
  if (token.kind === "code") {
    const shouldKeepCodeTokenOnOneLine = token.text.length <= 16;

    return (
      <code
        className={cn(
          "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
          shouldKeepCodeTokenOnOneLine ? "whitespace-nowrap" : "break-words",
        )}
      >
        {token.text}
      </code>
    );
  }
  if (token.kind === "link") {
    return (
      <a
        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={token.href}
        rel={token.href.startsWith("http") ? "noreferrer" : undefined}
        target={token.href.startsWith("http") ? "_blank" : undefined}
      >
        {token.text}
      </a>
    );
  }
  if (token.kind === "imageLink") {
    if (isAttachmentDownloadHref(token.href)) {
      return (
        <span className="my-4 block max-w-full">
          <img
            alt={token.alt || t("image")}
            className="max-h-[70vh] max-w-full rounded-md border border-border bg-muted object-contain"
            loading="lazy"
            src={token.href}
          />
        </span>
      );
    }

    return (
      <span className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
        <ImageOff className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {token.remote ? t("remoteImage") : token.alt || t("image")}
        </span>
        <a
          className="inline-flex shrink-0 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={token.href}
          rel={token.href.startsWith("http") ? "noreferrer" : undefined}
          target={token.href.startsWith("http") ? "_blank" : undefined}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{t("openImage")}</span>
        </a>
      </span>
    );
  }

  return (
    <ObjectCodeButton
      code={token.code}
      organizationId={organizationId}
      spaceId={spaceId}
    />
  );
}

function isAttachmentDownloadHref(href: string): boolean {
  return /^\/api\/v1\/attachments\/[^/]+\/download$/u.test(href);
}

function ObjectCodeButton({
  code,
  organizationId,
  spaceId,
}: {
  code: string;
  organizationId?: string;
  spaceId?: string;
}) {
  const router = useRouter();
  const t = useTranslations("documents.markdown");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const openCode = async () => {
    if (!organizationId || state === "loading") {
      return;
    }

    setState("loading");
    try {
      const result = await lookupObjectCode({
        code,
        organizationId,
        ...(spaceId ? { spaceId } : {}),
      });
      router.push(getObjectCodeLookupHref(result));
    } catch {
      setState("error");
    }
  };

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 font-mono text-[0.9em] font-semibold text-primary underline-offset-4 hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        state === "error" && "text-destructive hover:bg-destructive/10",
      )}
      data-testid="document-object-code-link"
      title={state === "error" ? t("objectLookupFailed") : code}
      onClick={() => void openCode()}
    >
      {state === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : null}
      {code}
    </button>
  );
}
