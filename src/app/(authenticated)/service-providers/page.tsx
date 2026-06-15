import { redirect } from "next/navigation";

// The Service Providers list is absorbed into the unified People registry (UX
// refresh Phase 6b). Add/edit now lives on /people; the rich per-provider
// record (sends / routing) stays at /service-providers/[id] for now. Kept as a
// redirect so lingering /service-providers links resolve.
export default function ServiceProvidersRedirect() {
  redirect("/people");
}
