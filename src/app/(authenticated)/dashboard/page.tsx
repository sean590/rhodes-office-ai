import { redirect } from "next/navigation";

// The dashboard is superseded by Home (the Action Inbox). Kept as a redirect so
// any lingering /dashboard link lands on /home. (UX refresh D5.)
export default function DashboardRedirect() {
  redirect("/home");
}
