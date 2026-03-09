"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ChatDrawer } from "@/components/chat/chat-drawer";
import { ChatDrawerToggle } from "@/components/chat/chat-drawer-toggle";
import { PageContextProvider } from "@/components/chat/page-context-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { SessionGuard } from "@/components/session-guard";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isFullChatPage = pathname === "/chat";

  return (
    <PageContextProvider>
      <SessionGuard />
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Header />
        <main style={{
          flex: 1,
          padding: isMobile ? 16 : 28,
          paddingBottom: isMobile ? `calc(16px + 56px + env(safe-area-inset-bottom, 0px))` : 28,
          overflowY: "auto",
        }}>
          {children}
        </main>
        {isMobile && <MobileTabBar />}
      </div>

      {/* Chat drawer — hidden on the full /chat page */}
      {!isFullChatPage && (
        <>
          <ChatDrawerToggle
            isOpen={drawerOpen}
            onToggle={() => setDrawerOpen(!drawerOpen)}
            isMobile={isMobile}
          />
          <ChatDrawer
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            isMobile={isMobile}
          />
        </>
      )}
    </PageContextProvider>
  );
}
