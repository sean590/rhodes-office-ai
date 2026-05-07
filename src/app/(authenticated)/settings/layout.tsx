"use client";

import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const setPageContext = useSetPageContext();

  useEffect(() => {
    setPageContext({ page: "settings" });
    return () => setPageContext(null);
  }, [setPageContext]);

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        gap: isMobile ? 0 : 32,
      }}
    >
      <SettingsSidebar />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
