"use client";

import { ChatIcon, XIcon } from "@/components/ui/icons";

interface ChatDrawerToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  isMobile: boolean;
}

export function ChatDrawerToggle({ isOpen, onToggle, isMobile }: ChatDrawerToggleProps) {
  return (
    <button
      onClick={onToggle}
      aria-label={isOpen ? "Close chat" : "Ask Rhodes"}
      style={{
        position: "fixed",
        bottom: isMobile ? `calc(72px + env(safe-area-inset-bottom, 0px))` : 24,
        right: isMobile ? 16 : 24,
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: isOpen ? "#6b6b76" : "#2d5a3d",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        cursor: "pointer",
        zIndex: 51,
        border: "none",
        transition: "background 0.2s, transform 0.2s",
      }}
    >
      {isOpen ? <XIcon size={18} /> : <ChatIcon size={20} />}
    </button>
  );
}
