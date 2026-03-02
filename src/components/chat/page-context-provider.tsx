"use client";

import { createContext, useContext, useState } from "react";

export interface PageContext {
  page: string;
  entityId?: string;
  entityName?: string;
  documentId?: string;
  filters?: Record<string, string>;
}

const PageContextCtx = createContext<{
  context: PageContext | null;
  setContext: (ctx: PageContext | null) => void;
}>({ context: null, setContext: () => {} });

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<PageContext | null>(null);
  return (
    <PageContextCtx.Provider value={{ context, setContext }}>
      {children}
    </PageContextCtx.Provider>
  );
}

export function usePageContext() {
  return useContext(PageContextCtx).context;
}

export function useSetPageContext() {
  return useContext(PageContextCtx).setContext;
}
