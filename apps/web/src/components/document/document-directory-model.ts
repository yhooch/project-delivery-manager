import type { DocumentFilterKey, DocumentFolder } from "../../lib/document-service";

export const DOCUMENT_DIRECTORY_REFRESH_EVENT =
  "document-directory:refresh-after-drag";

export const DOCUMENT_LIST_REFRESH_EVENT = "documents:list-refresh-after-drag";

export const DOCUMENT_FOLDER_MAX_DEPTH = 6;

export type DocumentDirectoryView =
  | "all"
  | "recent"
  | "unfiled"
  | "createdByMe"
  | "archived"
  | "mcpCreated"
  | "recentMcpEdited"
  | "folder";

export type DocumentDirectorySelection = {
  folderId?: string | null;
  includeDescendants: boolean;
  view: DocumentDirectoryView;
};

export type DocumentFolderNode = Omit<DocumentFolder, "children"> & {
  children: DocumentFolderNode[];
};

export type FlatDocumentFolder = {
  depth: number;
  folder: DocumentFolder;
};

export type DocumentFolderDragData = {
  folderId: string;
  maxDescendantRelativeDepth: number;
  name: string;
  parentId: string | null;
  type: "document-folder";
  version: number;
};

export type DocumentDragData = {
  documents: Array<{
    folderId?: string | null;
    id: string;
    revision: number;
    title: string;
  }>;
  type: "document";
};

export type DocumentFolderDropData =
  | {
      ancestorIds: string[];
      depth: number;
      folderId: string;
      type: "document-folder-drop";
    }
  | {
      folderId: string;
      parentId: string | null;
      position: "before" | "after";
      siblingIds: string[];
      type: "document-folder-position";
    }
  | {
      siblingIds: string[];
      type: "document-folder-root";
    };

export type DocumentDragDataPayload =
  | DocumentDragData
  | DocumentFolderDragData;

export type DocumentDropDataPayload = DocumentFolderDropData;

const DIRECTORY_VIEWS = new Set<DocumentDirectoryView>([
  "all",
  "recent",
  "unfiled",
  "createdByMe",
  "archived",
  "mcpCreated",
  "recentMcpEdited",
  "folder",
]);

export function getDocumentDirectorySelection(
  searchParams: URLSearchParams,
): DocumentDirectorySelection {
  const folderId = normalizeSearchParam(searchParams.get("folderId"));
  const rawView = normalizeSearchParam(searchParams.get("directoryView"));
  const view =
    rawView && DIRECTORY_VIEWS.has(rawView as DocumentDirectoryView)
      ? (rawView as DocumentDirectoryView)
      : folderId
        ? "folder"
        : "all";

  if (view === "folder" && folderId) {
    return {
      folderId,
      includeDescendants: searchParams.get("includeDescendants") === "true",
      view,
    };
  }

  return {
    folderId: view === "unfiled" ? null : undefined,
    includeDescendants: false,
    view: view === "folder" ? "all" : view,
  };
}

export function getDocumentFilterForDirectoryView(
  view: DocumentDirectoryView,
): DocumentFilterKey {
  if (view === "archived") {
    return "archived";
  }
  if (view === "createdByMe") {
    return "createdByMe";
  }
  if (view === "mcpCreated") {
    return "mcpCreated";
  }
  if (view === "recentMcpEdited") {
    return "recentMcpEdited";
  }
  return "all";
}

export function createDocumentDirectoryHref(
  selection: Partial<DocumentDirectorySelection>,
): string {
  const params = new URLSearchParams();
  const view = selection.view ?? "all";

  if (view !== "all") {
    params.set("directoryView", view);
  }
  if (view === "folder" && selection.folderId) {
    params.set("folderId", selection.folderId);
    if (selection.includeDescendants) {
      params.set("includeDescendants", "true");
    }
  }

  const query = params.toString();
  return query ? `/documents?${query}` : "/documents";
}

export function normalizeDocumentFolderTree(
  folders: DocumentFolder[],
): DocumentFolderNode[] {
  if (folders.some((folder) => (folder.children ?? []).length > 0)) {
    return sortFolderNodes(folders.map(toFolderNode));
  }

  const nodes = new Map<string, DocumentFolderNode>();
  folders.forEach((folder) => {
    nodes.set(folder.id, { ...folder, children: [] });
  });

  const roots: DocumentFolderNode[] = [];
  nodes.forEach((node) => {
    const parentId = node.parentId ?? null;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return sortFolderNodes(roots);
}

export function flattenDocumentFolders(
  folders: DocumentFolderNode[],
): FlatDocumentFolder[] {
  const result: FlatDocumentFolder[] = [];
  const visit = (nodes: DocumentFolderNode[], depth: number) => {
    nodes.forEach((node) => {
      result.push({ depth, folder: node });
      visit(node.children, depth + 1);
    });
  };

  visit(folders, 0);
  return result;
}

export function getFolderMaxDescendantRelativeDepth(
  folder: DocumentFolderNode,
): number {
  if (folder.children.length === 0) {
    return 0;
  }

  return Math.max(
    ...folder.children.map(
      (child) => 1 + getFolderMaxDescendantRelativeDepth(child),
    ),
  );
}

export function isFolderInSubtree(
  folders: DocumentFolderNode[],
  rootId: string,
  candidateId: string,
): boolean {
  const root = findFolderNode(folders, rootId);
  if (!root) {
    return false;
  }

  return Boolean(findFolderNode(root.children, candidateId));
}

export function findFolderNode(
  folders: DocumentFolderNode[],
  folderId: string,
): DocumentFolderNode | undefined {
  for (const folder of folders) {
    if (folder.id === folderId) {
      return folder;
    }
    const child = findFolderNode(folder.children, folderId);
    if (child) {
      return child;
    }
  }

  return undefined;
}

function toFolderNode(folder: DocumentFolder): DocumentFolderNode {
  return {
    ...folder,
    children: sortFolderNodes((folder.children ?? []).map(toFolderNode)),
  };
}

function sortFolderNodes(nodes: DocumentFolderNode[]): DocumentFolderNode[] {
  return [...nodes].sort((left, right) => {
    const byOrder = left.sortOrder - right.sortOrder;
    if (byOrder !== 0) {
      return byOrder;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
