import { redirect } from "next/navigation";

// The org-wide Activity log moved out of Settings into Home → Done (UX refresh
// Phase 7). Kept as a redirect so old /settings/activity links resolve.
export default function SettingsActivityRedirect() {
  redirect("/home");
}
