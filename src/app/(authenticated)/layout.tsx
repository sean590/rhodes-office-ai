"use client";

import { Header } from "@/components/layout/header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { useIsMobile } from "@/hooks/use-mobile";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  return (
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
  );
}
