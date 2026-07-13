import { redirect } from "next/navigation";

// The /review page is superseded by the UX refresh: approvals moved to Home
// (Needs you), document *status* moved to Processing, and uploads happen in
// chat. Kept as a redirect so lingering /review links land on Processing.
// (UX refresh Phase 3, decision D7 — no batch as a UX concept.)
export default function ReviewRedirect() {
  redirect("/processing");
}
