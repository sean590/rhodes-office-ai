"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DownIcon } from "../ui/icons";

interface UserInfo {
  email: string;
  display_name: string | null;
  role: string;
}

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setUserInfo(data);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const displayName = userInfo?.display_name || userInfo?.email?.split("@")[0] || "User";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
          borderRadius: 8, border: "1px solid #ddd9d0", cursor: "pointer",
          background: "transparent", color: "#1a1a1f", fontFamily: "inherit", fontSize: 13,
        }}
      >
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "linear-gradient(135deg, #2d5a3d, #3d7a53)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 600, color: "#fff",
        }}>
          {initials}
        </div>
        <span style={{ fontWeight: 500 }}>{displayName}</span>
        <DownIcon />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 6,
          background: "#ffffff", border: "1px solid #ddd9d0", borderRadius: 10,
          padding: 6, minWidth: 180, zIndex: 100, boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
        }}>
          {userInfo && (
            <div style={{
              padding: "8px 12px",
              borderBottom: "1px solid #f0eeea",
              marginBottom: 4,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1f" }}>
                {userInfo.email}
              </div>
              <div style={{
                fontSize: 11,
                color: "#9494a0",
                marginTop: 2,
                textTransform: "capitalize",
              }}>
                {userInfo.role}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              background: "transparent", color: "#1a1a1f", fontFamily: "inherit", fontSize: 13,
              textAlign: "left",
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
