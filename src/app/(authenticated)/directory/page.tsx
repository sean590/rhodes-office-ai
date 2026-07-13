import { redirect } from "next/navigation";

// The Directory is absorbed into the unified People registry (UX refresh
// Phase 6b). Add/edit/delete of contacts now lives on /people. Kept as a
// redirect so lingering /directory links resolve.
export default function DirectoryRedirect() {
  redirect("/people");
}
