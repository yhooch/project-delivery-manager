"use client";

import { createContext, useContext } from "react";

type DocumentDirectoryContextValue = {
  activeDocumentFolderId?: string | null;
  setActiveDocumentFolderId: (folderId: string | null | undefined) => void;
};

const DocumentDirectoryContext = createContext<DocumentDirectoryContextValue>({
  activeDocumentFolderId: undefined,
  setActiveDocumentFolderId: () => {},
});

export const DocumentDirectoryProvider = DocumentDirectoryContext.Provider;

export function useDocumentDirectory(): DocumentDirectoryContextValue {
  return useContext(DocumentDirectoryContext);
}
