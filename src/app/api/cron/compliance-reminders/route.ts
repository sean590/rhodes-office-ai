import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { complianceReminderEmail } from "@/lib/email-templates";
import * as Sentry from "@sentry/nextjs";

const { logger } = Sentry;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Sentry.startSpan(
    { op: "cron", name: "compliance-reminders" },
    async (span) => {
      try {
        const admin = createAdminClient();
        const now = new Date();
        const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Find pending obligations due within 7 days
        const { data: obligations, error } = await admin
          .from("compliance_obligations")
          .select("id, name, next_due_date, entity_id, last_reminder_sent")
          .eq("status", "pending")
          .lte("next_due_date", sevenDaysOut.toISOString())
          .gte("next_due_date", now.toISOString());

        if (error) {
          logger.error("Failed to fetch compliance obligations", { error: error.message });
          return Response.json({ error: error.message }, { status: 500 });
        }

        if (!obligations || obligations.length === 0) {
          span.setAttribute("obligations_found", 0);
          return Response.json({ sent: 0, message: "No upcoming obligations" });
        }

        // Filter out obligations that were already reminded today
        const todayStr = now.toISOString().split("T")[0];
        const needsReminder = obligations.filter(
          (o) => !o.last_reminder_sent || !o.last_reminder_sent.startsWith(todayStr)
        );

        if (needsReminder.length === 0) {
          span.setAttribute("obligations_found", obligations.length);
          span.setAttribute("already_reminded", obligations.length);
          return Response.json({ sent: 0, message: "All already reminded today" });
        }

        // Fetch entity names for the obligations
        const entityIds = [...new Set(needsReminder.map((o) => o.entity_id).filter(Boolean))];
        const { data: entities } = await admin
          .from("entities")
          .select("id, name")
          .in("id", entityIds);

        const entityMap = new Map<string, string>();
        for (const e of entities || []) {
          entityMap.set(e.id, e.name);
        }

        // Get all admin users to notify
        const { data: admins } = await admin
          .from("user_profiles")
          .select("id")
          .eq("role", "admin");

        const adminIds = (admins || []).map((a) => a.id);
        let adminEmails: string[] = [];

        if (adminIds.length > 0) {
          const { data: { users: authUsers } } = await admin.auth.admin.listUsers();
          if (authUsers) {
            adminEmails = authUsers
              .filter((u) => adminIds.includes(u.id) && u.email)
              .map((u) => u.email!);
          }
        }

        if (adminEmails.length === 0) {
          logger.warn("No admin emails found for compliance reminders");
          return Response.json({ sent: 0, message: "No admin emails configured" });
        }

        // Build obligation list for email
        const emailObligations = needsReminder.map((o) => ({
          name: o.name || "Unnamed obligation",
          dueDate: o.next_due_date
            ? new Date(o.next_due_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Unknown",
          entityName: entityMap.get(o.entity_id) || "Unknown Entity",
        }));

        const html = complianceReminderEmail(emailObligations);

        // Send to each admin
        let sentCount = 0;
        for (const email of adminEmails) {
          await sendEmail({
            to: email,
            subject: `Rhodes: ${needsReminder.length} compliance deadline${needsReminder.length > 1 ? "s" : ""} approaching`,
            html,
          });
          sentCount++;
        }

        // Mark reminders as sent
        const reminderIds = needsReminder.map((o) => o.id);
        await admin
          .from("compliance_obligations")
          .update({ last_reminder_sent: now.toISOString() })
          .in("id", reminderIds);

        span.setAttribute("obligations_found", needsReminder.length);
        span.setAttribute("emails_sent", sentCount);
        logger.info("Compliance reminders sent", {
          obligations: needsReminder.length,
          recipients: sentCount,
        });

        return Response.json({
          sent: sentCount,
          obligations: needsReminder.length,
        });
      } catch (err) {
        Sentry.captureException(err);
        logger.error("Compliance reminder cron failed", {
          error: err instanceof Error ? err.message : "Unknown",
        });
        return Response.json({ error: "Internal error" }, { status: 500 });
      }
    }
  );
}
