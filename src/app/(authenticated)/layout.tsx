import { Header } from "@/components/layout/header";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />
      <main style={{ flex: 1, padding: 28, overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
