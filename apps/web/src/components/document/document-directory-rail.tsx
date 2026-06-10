"use client";

import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  Files,
  Folder,
  FolderInput,
  FolderOpen,
  FolderTree,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { usePathname, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import type { DocumentFolder } from "../../lib/document-service";
import {
  createDocumentFolder,
  deleteDocumentFolder,
  listDocumentFolders,
  moveDocumentFolder,
  updateDocumentFolder,
} from "../../lib/document-service";
import { useRealtimeInvalidation } from "../../lib/realtime";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { useDocumentDirectory } from "./document-directory-context";
import {
  DOCUMENT_DIRECTORY_REFRESH_EVENT,
  DOCUMENT_FOLDER_MAX_DEPTH,
  createDocumentDirectoryHref,
  flattenDocumentFolders,
  getFolderMaxDescendantRelativeDepth,
  getDocumentDirectorySelection,
  isFolderInSubtree,
  normalizeDocumentFolderTree,
  type DocumentDragDataPayload,
  type DocumentFolderDropData,
  type DocumentDirectorySelection,
  type DocumentDirectoryView,
  type DocumentFolderNode,
  type FlatDocumentFolder,
} from "./document-directory-model";

const DOCUMENT_DIRECTORY_REALTIME_KEYS = [
  "document-directory",
  "document-list",
  "resource-documents",
] as const;
const FOLDER_TREE_INDENT_PX = 12;
const FOLDER_TREE_MAX_INDENT_LEVEL = 6;
const FOLDER_ANCESTOR_KEY_SEPARATOR = "\u0000";

type DocumentDirectoryRailProps = {
  className?: string;
  collapsed?: boolean;
  mobile?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
  organizationId?: string;
  spaceId?: string;
};

type FolderOperation =
  | { parent?: DocumentFolder; type: "create" }
  | { folder: DocumentFolder; type: "rename" }
  | { folder: DocumentFolder; type: "move" }
  | { folder: DocumentFolder; type: "delete" };

const VIRTUAL_VIEWS: Array<{
  icon: typeof Files;
  view: Exclude<DocumentDirectoryView, "folder">;
}> = [
  { icon: Files, view: "all" },
  { icon: User, view: "createdByMe" },
  { icon: Archive, view: "archived" },
];

export function DocumentDirectoryRail({
  className,
  collapsed = false,
  mobile = false,
  onCollapsedChange,
  onNavigate,
  organizationId,
  spaceId,
}: DocumentDirectoryRailProps) {
  const t = useTranslations("documents.directory");
  const tRoot = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeDocumentFolderId } = useDocumentDirectory();
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<FolderOperation | null>(null);
  const initializedCollapseSpaceIdRef = useRef<string | undefined>(undefined);

  const selection = useMemo(
    () =>
      getDocumentDirectorySelection(
        new URLSearchParams(searchParams.toString()),
      ),
    [searchParams],
  );
  const tree = useMemo(() => normalizeDocumentFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenDocumentFolders(tree), [tree]);
  const activeFolderId = isDocumentDetailPath(pathname)
    ? activeDocumentFolderId
    : selection.view === "folder"
      ? selection.folderId
      : undefined;
  const rootFolderActive =
    !isDocumentDetailPath(pathname) && selection.view === "root";
  const activeFolderAncestorIds = useMemo(
    () => getFolderAncestorIds(tree, activeFolderId),
    [activeFolderId, tree],
  );
  const activeFolderAncestorKey = activeFolderAncestorIds.join(
    FOLDER_ANCESTOR_KEY_SEPARATOR,
  );
  const collapsibleFolderIds = useMemo(
    () => getCollapsibleFolderIds(tree),
    [tree],
  );
  const hasCollapsibleFolders = collapsibleFolderIds.length > 0;
  const treeMatchesCurrentSpace =
    Boolean(spaceId) &&
    tree.length > 0 &&
    tree.every((folder) => folder.spaceId === spaceId);
  const initialCollapsedFolderIds =
    treeMatchesCurrentSpace && initializedCollapseSpaceIdRef.current !== spaceId
      ? new Set(
          collapsibleFolderIds.filter(
            (folderId) => !activeFolderAncestorIds.includes(folderId),
          ),
        )
      : null;
  const effectiveCollapsedFolderIds =
    initialCollapsedFolderIds ?? collapsedFolderIds;
  const allFoldersExpanded =
    hasCollapsibleFolders &&
    collapsibleFolderIds.every(
      (folderId) => !effectiveCollapsedFolderIds.has(folderId),
    );
  const folderTreeActionsLabel = !hasCollapsibleFolders
    ? t("toggleAllFoldersDisabled")
    : t("folderTreeActions");
  const canFocusCurrentFolder = rootFolderActive || Boolean(activeFolderId);

  const loadFolders = useCallback(
    async (options?: { realtime?: boolean }) => {
      if (!spaceId) {
        setFolders([]);
        return;
      }

      const isRealtime = options?.realtime === true;
      if (!isRealtime) {
        setIsLoading(true);
        setErrorKey(null);
      }

      try {
        const next = await listDocumentFolders({ organizationId, spaceId });
        setFolders(next);
      } catch (error) {
        if (!isRealtime) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (!isRealtime) {
          setIsLoading(false);
        }
      }
    },
    [organizationId, spaceId],
  );

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (!spaceId) {
      initializedCollapseSpaceIdRef.current = undefined;
      setCollapsedFolderIds(new Set());
    }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId || !treeMatchesCurrentSpace) {
      return;
    }

    if (initializedCollapseSpaceIdRef.current === spaceId) {
      return;
    }

    initializedCollapseSpaceIdRef.current = spaceId;
    const activeAncestors = new Set(activeFolderAncestorIds);
    setCollapsedFolderIds(
      new Set(
        collapsibleFolderIds.filter(
          (folderId) => !activeAncestors.has(folderId),
        ),
      ),
    );
  }, [
    activeFolderAncestorIds,
    collapsibleFolderIds,
    spaceId,
    treeMatchesCurrentSpace,
  ]);

  useEffect(() => {
    if (!activeFolderAncestorKey) {
      return;
    }

    const ancestorIds = activeFolderAncestorKey.split(
      FOLDER_ANCESTOR_KEY_SEPARATOR,
    );
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      let changed = false;
      ancestorIds.forEach((folderId) => {
        changed = next.delete(folderId) || changed;
      });
      return changed ? next : current;
    });
  }, [activeFolderAncestorKey]);

  useRealtimeInvalidation(DOCUMENT_DIRECTORY_REALTIME_KEYS, () => {
    void loadFolders({ realtime: true });
  });

  useEffect(() => {
    const handleRefresh = () => {
      void loadFolders({ realtime: true });
    };
    window.addEventListener(DOCUMENT_DIRECTORY_REFRESH_EVENT, handleRefresh);
    return () =>
      window.removeEventListener(
        DOCUMENT_DIRECTORY_REFRESH_EVENT,
        handleRefresh,
      );
  }, [loadFolders]);

  const navigateToSelection = useCallback(
    (nextSelection: Partial<DocumentDirectorySelection>) => {
      router.push(createDocumentDirectoryHref(nextSelection) as never);
      onNavigate?.();
    },
    [onNavigate, router],
  );

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const expandAllFolders = () => {
    if (!hasCollapsibleFolders) {
      return;
    }

    setCollapsedFolderIds(new Set());
  };

  const collapseAllFolders = () => {
    if (!hasCollapsibleFolders) {
      return;
    }

    const activeAncestors = new Set(activeFolderAncestorIds);
    setCollapsedFolderIds(
      new Set(
        collapsibleFolderIds.filter(
          (folderId) => !activeAncestors.has(folderId),
        ),
      ),
    );
  };

  const focusCurrentFolder = () => {
    if (!hasCollapsibleFolders || !canFocusCurrentFolder) {
      return;
    }

    const expandedFolderIds = new Set(activeFolderAncestorIds);
    if (activeFolderId) {
      expandedFolderIds.add(activeFolderId);
    }

    setCollapsedFolderIds(
      new Set(
        collapsibleFolderIds.filter(
          (folderId) => !expandedFolderIds.has(folderId),
        ),
      ),
    );
  };

  const handleOperationDone = async (deletedFolderId?: string) => {
    setOperation(null);
    await loadFolders();
    if (deletedFolderId && activeFolderId === deletedFolderId) {
      navigateToSelection({ view: "all" });
    }
  };

  if (collapsed && !mobile) {
    return (
      <aside
        className={cn(
          "hidden w-12 shrink-0 border-r border-border/60 bg-gradient-to-b from-muted/30 to-background lg:flex lg:flex-col lg:items-center lg:gap-3 lg:py-3",
          className,
        )}
        data-testid="document-directory-rail-collapsed"
      >
        <Button
          aria-label={t("expand")}
          className="h-8 w-8"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="h-px w-6 bg-border/60" />
        <div className="flex flex-col items-center gap-1.5">
          {VIRTUAL_VIEWS.map(({ icon: Icon, view }) => {
            const isActive =
              !isDocumentDetailPath(pathname) && selection.view === view;
            return (
              <Tip key={view} content={t(`views.${view}`)}>
                <button
                  type="button"
                  aria-label={t(`views.${view}`)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => navigateToSelection({ view })}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tip>
            );
          })}
        </div>
        <div className="mt-auto">
          <Tip content={t("createRoot")}>
            <Button
              aria-label={t("createRoot")}
              className="h-8 w-8"
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => setOperation({ type: "create" })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tip>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "relative h-full min-h-0 flex-col bg-gradient-to-b from-muted/30 to-background text-sm",
        mobile
          ? "flex w-full"
          : "hidden lg:flex lg:w-72 lg:shrink-0 lg:border-r lg:border-border/60",
        className,
      )}
      data-testid="document-directory-rail"
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center justify-between gap-2 px-3",
          mobile && "pr-12",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="truncate text-[13px] font-semibold tracking-tight">
            {t("title")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tip content={t("createRoot")}>
            <Button
              aria-label={t("createRoot")}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => setOperation({ type: "create" })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tip>
          {!mobile ? (
            <Tip content={t("collapse")}>
              <Button
                aria-label={t("collapse")}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={() => onCollapsedChange?.(true)}
              >
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tip>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        <nav aria-label={t("viewsLabel")} className="grid gap-0.5">
          {VIRTUAL_VIEWS.map(({ icon: Icon, view }) => (
            <DirectoryNavButton
              key={view}
              active={
                !isDocumentDetailPath(pathname) && selection.view === view
              }
              icon={<Icon className="h-4 w-4" aria-hidden="true" />}
              label={t(`views.${view}`)}
              onClick={() => navigateToSelection({ view })}
            />
          ))}
        </nav>

        <div className="mt-5 flex items-center justify-between gap-2 px-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
            {t("folders")}
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
            <HeaderIconTip
              content={folderTreeActionsLabel}
              disabled={!hasCollapsibleFolders}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={folderTreeActionsLabel}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    disabled={!hasCollapsibleFolders}
                    size="icon-sm"
                    title={folderTreeActionsLabel}
                    type="button"
                    variant="ghost"
                  >
                    <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    disabled={allFoldersExpanded}
                    onSelect={expandAllFolders}
                  >
                    <ChevronsDown className="h-4 w-4" aria-hidden="true" />
                    {t("expandAllFolders")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={collapseAllFolders}>
                    <ChevronsUp className="h-4 w-4" aria-hidden="true" />
                    {t("collapseAllFolders")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!canFocusCurrentFolder}
                    onSelect={focusCurrentFolder}
                  >
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                    {t("focusCurrentFolder")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </HeaderIconTip>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>

        {errorKey ? (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {tRoot(errorKey)}
          </p>
        ) : null}

        {!isLoading && !errorKey ? (
          <div className="mt-2 grid gap-0.5">
            <FolderRootNode
              active={rootFolderActive}
              onSelect={() => navigateToSelection({ view: "root" })}
              siblingIds={tree.map((folder) => folder.id)}
            />
            {tree.length === 0 ? (
              <div className="mt-1 flex flex-col items-start gap-1 rounded-lg border border-dashed border-border/60 bg-card/60 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  {t("emptyFolders")}
                </p>
              </div>
            ) : (
              tree.map((folder) => (
                <FolderTreeNode
                  key={folder.id}
                  activeFolderId={activeFolderId}
                  ancestorIds={[]}
                  collapsedFolderIds={effectiveCollapsedFolderIds}
                  folder={folder}
                  level={0}
                  onCreateChild={(parent) =>
                    setOperation({ parent, type: "create" })
                  }
                  onDelete={(nextFolder) =>
                    setOperation({ folder: nextFolder, type: "delete" })
                  }
                  onMove={(nextFolder) =>
                    setOperation({ folder: nextFolder, type: "move" })
                  }
                  onRename={(nextFolder) =>
                    setOperation({ folder: nextFolder, type: "rename" })
                  }
                  onSelect={(folderId) =>
                    navigateToSelection({
                      folderId,
                      includeDescendants: selection.includeDescendants,
                      view: "folder",
                    })
                  }
                  siblingIds={tree.map((sibling) => sibling.id)}
                  onToggle={toggleFolder}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <DocumentFolderOperationDialog
        flatFolders={flatFolders}
        folders={tree}
        onDone={(deletedFolderId) => void handleOperationDone(deletedFolderId)}
        onOpenChange={(open) => {
          if (!open) {
            setOperation(null);
          }
        }}
        operation={operation}
        organizationId={organizationId}
        spaceId={spaceId}
      />
    </aside>
  );
}

function DirectoryNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-primary"
          : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-primary"
        />
      ) : null}
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-primary/20 text-primary"
            : "bg-muted/60 text-muted-foreground group-hover/nav:bg-background group-hover/nav:text-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function HeaderIconTip({
  children,
  content,
  disabled,
}: {
  children: ReactElement;
  content: ReactNode;
  disabled?: boolean;
}) {
  if (!disabled) {
    return <Tip content={content}>{children}</Tip>;
  }

  return (
    <Tip content={content}>
      <span
        className="inline-flex"
        title={typeof content === "string" ? content : undefined}
      >
        {children}
      </span>
    </Tip>
  );
}

function FolderTreeNode({
  activeFolderId,
  ancestorIds,
  collapsedFolderIds,
  folder,
  level,
  onCreateChild,
  onDelete,
  onMove,
  onRename,
  onSelect,
  siblingIds,
  onToggle,
}: {
  activeFolderId?: string | null;
  ancestorIds: string[];
  collapsedFolderIds: Set<string>;
  folder: DocumentFolderNode;
  level: number;
  onCreateChild: (folder: DocumentFolder) => void;
  onDelete: (folder: DocumentFolder) => void;
  onMove: (folder: DocumentFolder) => void;
  onRename: (folder: DocumentFolder) => void;
  onSelect: (folderId: string) => void;
  siblingIds: string[];
  onToggle: (folderId: string) => void;
}) {
  const t = useTranslations("documents.directory");
  const hasChildren = folder.children.length > 0;
  const isCollapsed = collapsedFolderIds.has(folder.id);
  const isActive = activeFolderId === folder.id;
  const count = folder.descendantDocumentCount || folder.documentCount;
  const draggable = useDraggable({
    id: `document-folder:${folder.id}`,
    data: {
      folderId: folder.id,
      maxDescendantRelativeDepth: getFolderMaxDescendantRelativeDepth(folder),
      name: folder.name,
      parentId: folder.parentId ?? null,
      type: "document-folder",
      version: folder.version,
    } satisfies DocumentDragDataPayload,
  });
  const folderDrop = useDroppable({
    id: `document-folder-drop:${folder.id}`,
    data: {
      ancestorIds,
      depth: level,
      folderId: folder.id,
      type: "document-folder-drop",
    } satisfies DocumentFolderDropData,
  });
  const beforeDrop = useDroppable({
    id: `document-folder-position:${folder.id}:before`,
    data: {
      folderId: folder.id,
      parentId: folder.parentId ?? null,
      position: "before",
      siblingIds,
      type: "document-folder-position",
    } satisfies DocumentFolderDropData,
  });
  const afterDrop = useDroppable({
    id: `document-folder-position:${folder.id}:after`,
    data: {
      folderId: folder.id,
      parentId: folder.parentId ?? null,
      position: "after",
      siblingIds,
      type: "document-folder-position",
    } satisfies DocumentFolderDropData,
  });
  const activeDrag = useActiveDocumentDragData();
  const canDropIntoFolder =
    activeDrag?.type === "document" ||
    (activeDrag?.type === "document-folder" &&
      activeDrag.folderId !== folder.id &&
      !ancestorIds.includes(activeDrag.folderId) &&
      level + 1 + activeDrag.maxDescendantRelativeDepth <=
        DOCUMENT_FOLDER_MAX_DEPTH);
  const canReorderFolder =
    activeDrag?.type === "document-folder" &&
    activeDrag.parentId === (folder.parentId ?? null) &&
    activeDrag.folderId !== folder.id;
  const isDragging = draggable.isDragging;
  const indent =
    Math.min(level, FOLDER_TREE_MAX_INDENT_LEVEL) * FOLDER_TREE_INDENT_PX;

  return (
    <div
      ref={draggable.setNodeRef}
      className={cn(isDragging && "opacity-50")}
      data-testid="document-folder-tree-node"
    >
      <FolderPositionDropLine
        active={beforeDrop.isOver && canReorderFolder}
        indent={indent}
        setNodeRef={beforeDrop.setNodeRef}
      />
      <div
        ref={folderDrop.setNodeRef}
        className="relative min-w-0"
        data-document-drop-target="folder"
        data-testid="document-folder-row-frame"
        style={{ paddingLeft: `${indent}px` }}
      >
        {level > 0
          ? Array.from({ length: level }).map((_, depth) => (
              <span
                key={depth}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-border/60"
                style={{
                  left: `${depth * FOLDER_TREE_INDENT_PX + 14}px`,
                }}
              />
            ))
          : null}
        <div
          className={cn(
            "group relative grid min-h-8 min-w-0 grid-cols-[1.5rem_1.5rem_minmax(0,1fr)_1.5rem] items-center gap-0.5 rounded-lg pr-1 transition-all",
            isActive
              ? "bg-primary/12 text-primary shadow-sm ring-1 ring-primary/20"
              : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
            folderDrop.isOver &&
              canDropIntoFolder &&
              "bg-primary/15 text-primary ring-1 ring-primary/40",
          )}
          data-testid="document-folder-row"
        >
          <Button
            aria-label={t("drag.folderHandle", { name: folder.name })}
            className="h-6 w-6 cursor-grab text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-focus-within:opacity-100 group-hover:opacity-100"
            data-testid="document-folder-drag-handle"
            size="icon-sm"
            type="button"
            variant="ghost"
            ref={draggable.setActivatorNodeRef}
            style={{ touchAction: "none" }}
            {...draggable.attributes}
            {...draggable.listeners}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {hasChildren ? (
            <button
              type="button"
              aria-label={t("toggleFolder", { name: folder.name })}
              aria-expanded={!isCollapsed}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "hover:bg-primary/10"
                  : "hover:bg-background",
              )}
              onClick={() => onToggle(folder.id)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="h-6 w-6"
              data-testid="document-folder-toggle-spacer"
            />
          )}
          <button
            type="button"
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-0 items-center gap-1.5 rounded py-1.5 pr-1 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(folder.id)}
          >
            {isActive ? (
              <FolderOpen
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : (
              <Folder
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {count > 0 ? (
              <span
                className={cn(
                  "inline-flex h-4 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums",
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="h-4 min-w-5 shrink-0"
                data-testid="document-folder-count-spacer"
              />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("folderActions", { name: folder.name })}
                className="h-6 w-6 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onCreateChild(folder)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("createChild")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(folder)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(folder)}>
                <FolderInput className="h-4 w-4" aria-hidden="true" />
                {t("move")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(folder)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="mt-0.5 grid gap-0.5">
          {folder.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              activeFolderId={activeFolderId}
              ancestorIds={[...ancestorIds, folder.id]}
              collapsedFolderIds={collapsedFolderIds}
              folder={child}
              level={level + 1}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              onMove={onMove}
              onRename={onRename}
              onSelect={onSelect}
              siblingIds={folder.children.map((sibling) => sibling.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
      <FolderPositionDropLine
        active={afterDrop.isOver && canReorderFolder}
        indent={indent}
        setNodeRef={afterDrop.setNodeRef}
      />
    </div>
  );
}

function FolderRootNode({
  active,
  onSelect,
  siblingIds,
}: {
  active: boolean;
  onSelect: () => void;
  siblingIds: string[];
}) {
  const t = useTranslations("documents.directory");
  const rootDrop = useDroppable({
    id: "document-folder-root-drop",
    data: {
      siblingIds,
      type: "document-folder-root",
    } satisfies DocumentFolderDropData,
  });
  const activeDrag = useActiveDocumentDragData();
  const canDropToRoot =
    activeDrag?.type === "document"
      ? activeDrag.documents.some((document) => document.folderId != null)
      : activeDrag?.type === "document-folder" && activeDrag.parentId !== null;

  return (
    <div
      ref={rootDrop.setNodeRef}
      className={cn(
        "relative min-w-0 rounded-lg transition-all",
        active
          ? "bg-primary/12 text-primary shadow-sm ring-1 ring-primary/20"
          : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
        canDropToRoot && "ring-1 ring-border/80",
        rootDrop.isOver &&
          canDropToRoot &&
          "bg-primary/15 text-primary ring-1 ring-primary/40",
      )}
      data-document-folder-root-drop-target="true"
      data-testid="document-folder-root-drop-target"
      title={t("drag.rootDrop")}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className="flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="document-folder-root-node"
        onClick={onSelect}
      >
        {active ? (
          <FolderOpen
            className="h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        ) : (
          <Folder
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{t("rootFolder")}</span>
      </button>
    </div>
  );
}

function FolderPositionDropLine({
  active,
  indent,
  setNodeRef,
}: {
  active: boolean;
  indent: number;
  setNodeRef: (element: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={setNodeRef}
      className="h-1 min-w-0"
      data-testid="document-folder-position-drop-target"
      style={{ paddingLeft: `${indent}px` }}
    >
      <div className={cn("h-full rounded-full", active && "bg-primary")} />
    </div>
  );
}

function useActiveDocumentDragData() {
  const { active } = useDndContext();
  const data = active?.data.current;

  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as Partial<DocumentDragDataPayload>;
  return payload.type === "document" || payload.type === "document-folder"
    ? (payload as DocumentDragDataPayload)
    : null;
}

function DocumentFolderOperationDialog({
  flatFolders,
  folders,
  onDone,
  onOpenChange,
  operation,
  organizationId,
  spaceId,
}: {
  flatFolders: FlatDocumentFolder[];
  folders: DocumentFolderNode[];
  onDone: (deletedFolderId?: string) => void;
  onOpenChange: (open: boolean) => void;
  operation: FolderOperation | null;
  organizationId?: string;
  spaceId?: string;
}) {
  const t = useTranslations("documents.directory.dialog");
  const tRoot = useTranslations();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const folder =
    operation && "folder" in operation ? operation.folder : undefined;
  const mode = operation?.type;

  useEffect(() => {
    setName(folder?.name ?? "");
    setParentId(folder?.parentId ?? "");
    setErrorKey(null);
  }, [folder?.id, folder?.name, folder?.parentId, mode]);

  if (!operation) {
    return null;
  }

  const titleKey = operation.type;
  const parentOptions = getMoveParentOptions({
    flatFolders,
    folderId: folder?.id,
    folders,
  });
  const canSubmit =
    Boolean(spaceId) &&
    (operation.type === "delete" ||
      operation.type === "move" ||
      (name.trim().length > 0 && name.trim().length <= 120));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!spaceId || !canSubmit) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    try {
      if (operation.type === "create") {
        await createDocumentFolder({
          name: name.trim(),
          organizationId,
          parentId: operation.parent?.id ?? null,
          spaceId,
        });
        onDone();
      } else if (operation.type === "rename" && folder) {
        await updateDocumentFolder({
          folderId: folder.id,
          name: name.trim(),
          organizationId,
          spaceId,
          version: folder.version,
        });
        onDone();
      } else if (operation.type === "move" && folder) {
        await moveDocumentFolder({
          folderId: folder.id,
          organizationId,
          parentId: parentId || null,
          spaceId,
          version: folder.version,
        });
        onDone();
      } else if (operation.type === "delete" && folder) {
        await deleteDocumentFolder({
          folderId: folder.id,
          organizationId,
          spaceId,
        });
        onDone(folder.id);
      }
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(operation)} onOpenChange={onOpenChange}>
      <DialogContent data-testid="document-folder-operation-dialog">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{t(`title.${titleKey}`)}</DialogTitle>
            <DialogDescription>
              {operation.type === "create" && operation.parent
                ? t("description.createChild", { name: operation.parent.name })
                : t(`description.${titleKey}`, { name: folder?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {operation.type === "create" || operation.type === "rename" ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("nameLabel")}</span>
              <Input
                autoFocus
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-testid="document-folder-name-input"
              />
            </label>
          ) : null}

          {operation.type === "move" ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("parentLabel")}</span>
              <SelectMenu
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                data-testid="document-folder-parent-select"
              >
                <option value="">{t("root")}</option>
                {parentOptions.map(({ depth, folder: optionFolder }) => (
                  <option key={optionFolder.id} value={optionFolder.id}>
                    {`${"\u00A0\u00A0".repeat(depth)}${optionFolder.name}`}
                  </option>
                ))}
              </SelectMenu>
            </label>
          ) : null}

          {errorKey ? (
            <p className="text-sm text-destructive" role="alert">
              {tRoot(errorKey)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant={operation.type === "delete" ? "destructive" : "default"}
              disabled={!canSubmit || isSaving}
              data-testid="document-folder-operation-submit"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t(`submit.${titleKey}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getMoveParentOptions({
  flatFolders,
  folderId,
  folders,
}: {
  flatFolders: FlatDocumentFolder[];
  folderId?: string;
  folders: DocumentFolderNode[];
}) {
  if (!folderId) {
    return flatFolders;
  }

  return flatFolders.filter(({ folder }) => {
    if (folder.id === folderId) {
      return false;
    }
    return !isFolderInSubtree(folders, folderId, folder.id);
  });
}

function getCollapsibleFolderIds(folders: DocumentFolderNode[]): string[] {
  const result: string[] = [];

  const visit = (nodes: DocumentFolderNode[]) => {
    nodes.forEach((folder) => {
      if (folder.children.length > 0) {
        result.push(folder.id);
        visit(folder.children);
      }
    });
  };

  visit(folders);
  return result;
}

function getFolderAncestorIds(
  folders: DocumentFolderNode[],
  folderId?: string | null,
): string[] {
  if (!folderId) {
    return [];
  }

  const visit = (
    nodes: DocumentFolderNode[],
    ancestorIds: string[],
  ): string[] | null => {
    for (const folder of nodes) {
      if (folder.id === folderId) {
        return ancestorIds;
      }

      const match = visit(folder.children, [...ancestorIds, folder.id]);
      if (match) {
        return match;
      }
    }

    return null;
  };

  return visit(folders, []) ?? [];
}

function isDocumentDetailPath(pathname: string): boolean {
  return /^\/documents\/[^/?#]+/u.test(pathname);
}
