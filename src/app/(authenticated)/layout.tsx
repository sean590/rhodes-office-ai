"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ChatDrawer } from "@/components/chat/chat-drawer";
import { ChatDrawerToggle } from "@/components/chat/chat-drawer-toggle";
import { PageContextProvider } from "@/components/chat/page-context-provider";
import { ChatPanelProvider, useChatPanel } from "@/components/chat/chat-panel-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { SessionGuard } from "@/components/session-guard";
import { SessionTimeoutManager } from "@/components/session-timeout-manager";
// CommandPalette intentionally not mounted — search/⌘K hidden until the
// surface gets enough testing. Component file kept for future re-enable.

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageContextProvider>
      <ChatPanelProvider>
        <SessionGuard />
        <SessionTimeoutManager />
        <LayoutInner>{children}</LayoutInner>
      </ChatPanelProvider>
    </PageContextProvider>
  );
}

function LayoutInner({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const isFullChatPage = pathname === "/chat";
  const { isOpen, close, toggle, panelWidth, setPanelWidth } = useChatPanel();

  const showPanel = !isFullChatPage && !isMobile && isOpen;

  return (
    <>
      {/*
        Outer wrapper bounds the app to the actual visible viewport.
        - height: 100dvh (NOT minHeight, NOT 100vh) — `dvh` handles mobile
          URL bar collapse so the wrapper never exceeds the visible area, and
          `height` makes it a hard ceiling (not a floor).
        - overflow: hidden — guarantees the body never scrolls regardless of
          what any descendant tries to do. This is the load-bearing line for
          the chat drawer's internal scroll chain (flex:1 + minHeight:0 +
          overflowY:auto on DrawerMessages) to actually work.
        Header has flexShrink: 0 set internally, so the row naturally gets
        "viewport minus header" via flex distribution — no hardcoded calc()
        needed, which means it adapts to the 48px mobile / 54px desktop
        header height difference automatically.
      */}
      <div style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <Header />
        <div style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
        }}>
          {/* Main content */}
          <main style={{
            flex: 1,
            padding: isMobile ? 16 : 28,
            paddingBottom: isMobile ? `calc(16px + 56px + env(safe-area-inset-bottom, 0px))` : 28,
            overflowY: "auto",
            minWidth: 0,
          }}>
            {children}
          </main>

          {/* Persistent chat panel (desktop only, not on /chat page) */}
          {showPanel && (
            <div style={{
              width: panelWidth,
              flexShrink: 0,
              borderLeft: "1px solid #e8e6df",
              display: "flex",
              flexDirection: "column",
              background: "#ffffff",
              position: "relative",
              // Let the row container's `align-items: stretch` give us the
              // full height (calc(100vh - 54px)). minHeight:0 + overflow:hidden
              // make sure children with flex:1 actually shrink to fit instead
              // of growing past the panel and scrolling the whole page.
              minHeight: 0,
              overflow: "hidden",
            }}>
              {/* Resize handle */}
              <div
                style={{
                  position: "absolute", left: -3, top: 0, bottom: 0, width: 6,
                  cursor: "col-resize", zIndex: 10,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startWidth = panelWidth;
                  const onMouseMove = (ev: MouseEvent) => {
                    const diff = startX - ev.clientX;
                    const newWidth = Math.min(Math.max(startWidth + diff, 320), window.innerWidth * 0.5);
                    setPanelWidth(newWidth);
                  };
                  const onMouseUp = () => {
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);
                  };
                  document.addEventListener("mousemove", onMouseMove);
                  document.addEventListener("mouseup", onMouseUp);
                }}
              />

              {/* Chat content — header is inside ChatDrawer */}
              <ChatDrawer isOpen={true} onClose={close} isMobile={false} embedded={true} />
            </div>
          )}
        </div>
        {isMobile && <MobileTabBar />}
      </div>

      {/* Panel toggle FAB (desktop, when panel is closed) */}
      {!isFullChatPage && !isMobile && !isOpen && (
        <button
          onClick={toggle}
          style={{
            position: "fixed", right: 20, bottom: 20,
            width: 48, height: 48, borderRadius: 24,
            background: "#2d5a3d", color: "#fff",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(45,90,61,0.3)",
            fontSize: 20, zIndex: 50,
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          title="Open chat panel"
        >
          ✦
        </button>
      )}

      {/* Mobile: keep existing drawer + toggle */}
      {isMobile && !isFullChatPage && (
        <>
          <ChatDrawerToggle isOpen={isOpen} onToggle={toggle} isMobile={true} />
          <ChatDrawer isOpen={isOpen} onClose={close} isMobile={true} />
        </>
      )}
    </>
  );
}
