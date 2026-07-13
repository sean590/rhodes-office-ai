import { redirect } from "next/navigation";

// Per-batch pages are deprecated by the UX refresh ("no batch as a UX
// concept"). Document status now lives on the unified Processing surface.
// Kept as a redirect so old /batches/[id] links (bell, chat handoff) resolve.
export default function BatchRedirect() {
  redirect("/processing");
}
