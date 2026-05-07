/**
 * /admin/feedback — owner-only view of chat_feedback rows.
 *
 * Server component. Route guard at the top: if the caller isn't an owner,
 * return notFound() rather than flashing the shell and then 404ing. Data
 * fetch hands off to /api/admin/feedback, which does the same role check
 * again. Belt + suspenders.
 */

import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/utils/auth";
import { FeedbackAdminClient } from "./FeedbackAdminClient";

export default async function FeedbackAdminPage() {
  const user = await getCurrentUser();
  if (!user || user.orgRole !== "owner") {
    notFound();
  }
  return <FeedbackAdminClient />;
}
