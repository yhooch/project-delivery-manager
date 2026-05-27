"use client";

import { createContext, useContext } from "react";

export type DocumentCreateContextValue = {
  openImport: () => void;
  openPaste: () => void;
};

const noop = () => {};

const DocumentCreateContext = createContext<DocumentCreateContextValue>({
  openImport: noop,
  openPaste: noop,
});

export const DocumentCreateProvider = DocumentCreateContext.Provider;

export function useDocumentCreate(): DocumentCreateContextValue {
  return useContext(DocumentCreateContext);
}
