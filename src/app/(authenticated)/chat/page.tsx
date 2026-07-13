"use client";

import { useEffect } from "react";
import { ChatDrawer } from "@/components/chat/chat-drawer";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Full-page chat — renders the same ChatDrawer component in an expanded layout.
 * This is "focus mode" for long conversations, accessible via the expand button
 * in the persistent panel header.
 *
 * The ChatDrawer with embedded=true handles all chat functionality:
 * - Sessions, messages, streaming
 * - File upload + v2 pipeline processing
 * - Approval cards, follow-ups, corrections
 */
export default function ChatPage() {
  const isMobile = useIsMobile();
  const setPageContext = useSetPageContext();

  useEffect(() => {
    setPageContext({ page: "chat" });
    return () => setPageContext(null);
  }, [setPageContext]);

  return (
    <div style={{
      height: "calc(100vh - 54px)",
      margin: isMobile ? -16 : -28,
      marginTop: isMobile ? -16 : -28,
      display: "flex",
      flexDirection: "row",
      overflow: "hidden",
      background: "#ffffff",
    }}>
      {/* Full-width chat — same component as the persistent panel */}
      <div style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
      }}>
        <ChatDrawer
          isOpen={true}
          onClose={() => {}} // No-op — can't close full page
          isMobile={isMobile}
          embedded={true}
        />
      </div>
    </div>
  );
}
