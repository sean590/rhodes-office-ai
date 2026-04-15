"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface ChatPanelContext {
  isOpen: boolean;
  open: (prefill?: string, files?: File[]) => void;
  close: () => void;
  toggle: () => void;
  prefillQuery: string | null;
  prefillFiles: File[];
  clearPrefill: () => void;
  panelWidth: number;
  setPanelWidth: (w: number) => void;
}

const ChatPanelCtx = createContext<ChatPanelContext>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  prefillQuery: null,
  prefillFiles: [],
  clearPrefill: () => {},
  panelWidth: 400,
  setPanelWidth: () => {},
});

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false); // Set after mount based on device
  const [prefillQuery, setPrefillQuery] = useState<string | null>(null);
  const [prefillFiles, setPrefillFiles] = useState<File[]>([]);
  const [panelWidth, setPanelWidth] = useState(400);

  // Load from localStorage, default open on desktop only.
  // setState in useEffect is the correct pattern for client-only hydration —
  // a lazy useState initializer would break SSR (window/localStorage
  // unavailable on the server). The React 19 set-state-in-effect rule is
  // disabled for this block; the cascade is one-shot on mount, not a render
  // loop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    try {
      const saved = localStorage.getItem("rhodes_chat_panel");
      if (saved) {
        const state = JSON.parse(saved);
        setIsOpen(isMobile ? false : (state.open ?? true));
        setPanelWidth(state.width ?? 400);
      } else {
        // First visit: default open on desktop, closed on mobile
        setIsOpen(!isMobile);
      }
    } catch {
      setIsOpen(!isMobile);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem("rhodes_chat_panel", JSON.stringify({ open: isOpen, width: panelWidth }));
  }, [isOpen, panelWidth]);

  const open = useCallback((prefill?: string, files?: File[]) => {
    if (prefill) setPrefillQuery(prefill);
    if (files && files.length > 0) setPrefillFiles(files);
    setIsOpen(true);
  }, []);

  // Listen for custom event from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      open(detail?.query, detail?.files);
    };
    window.addEventListener("rhodes:open-chat", handler);
    return () => window.removeEventListener("rhodes:open-chat", handler);
  }, [open]);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const clearPrefill = useCallback(() => { setPrefillQuery(null); setPrefillFiles([]); }, []);

  return (
    <ChatPanelCtx.Provider value={{ isOpen, open, close, toggle, prefillQuery, prefillFiles, clearPrefill, panelWidth, setPanelWidth }}>
      {children}
    </ChatPanelCtx.Provider>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelCtx);
}
