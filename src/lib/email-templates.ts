const BRAND = {
  green: "#2d5a3d",
  bg: "#f5f4f0",
  text: "#1a1a1f",
  muted: "#6b6b76",
  border: "#ddd9d0",
};

function layout(content: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'DM Sans',system-ui,sans-serif;color:${BRAND.text}">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid ${BRAND.border};overflow:hidden">
        <tr><td style="background:${BRAND.green};padding:24px 32px">
          <span style="color:#fff;font-size:20px;font-weight:600;letter-spacing:-0.3px">Rhodes</span>
        </td></tr>
        <tr><td style="padding:32px">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px">
          Rhodes Office &mdash; AI Family Office Platform
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function welcomeEmail(userName: string) {
  return layout(`
    <h2 style="margin:0 0 16px;font-size:18px">Welcome to Rhodes, ${userName}</h2>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 24px">
      Your account is ready. Rhodes helps you manage entities, track compliance,
      and process documents with AI — all in one place.
    </p>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai"}/entities"
       style="display:inline-block;background:${BRAND.green};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Go to Dashboard
    </a>
  `);
}

export function complianceReminderEmail(
  obligations: Array<{ name: string; dueDate: string; entityName: string }>
) {
  const rows = obligations
    .map(
      (o) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border}">${o.entityName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border}">${o.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border};font-weight:500">${o.dueDate}</td>
    </tr>`
    )
    .join("");

  return layout(`
    <h2 style="margin:0 0 8px;font-size:18px">Upcoming Compliance Deadlines</h2>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 24px">
      The following obligations are due soon. Review and take action to stay current.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;font-size:13px">
      <tr style="background:${BRAND.bg}">
        <th style="padding:8px 12px;text-align:left;font-weight:600">Entity</th>
        <th style="padding:8px 12px;text-align:left;font-weight:600">Obligation</th>
        <th style="padding:8px 12px;text-align:left;font-weight:600">Due Date</th>
      </tr>
      ${rows}
    </table>
    <div style="margin-top:24px">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai"}/entities"
         style="display:inline-block;background:${BRAND.green};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
        View in Rhodes
      </a>
    </div>
  `);
}

export function processingCompleteEmail(docName: string, entityName: string) {
  return layout(`
    <h2 style="margin:0 0 8px;font-size:18px">Document Processing Complete</h2>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 16px">
      AI extraction has finished for <strong>${docName}</strong>
      ${entityName ? ` (${entityName})` : ""}.
      Review the proposed changes and approve or reject them.
    </p>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai"}/documents"
       style="display:inline-block;background:${BRAND.green};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Review Document
    </a>
  `);
}

export function orgInviteEmail({
  orgName,
  inviterName,
  role,
  inviteUrl,
}: {
  orgName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}) {
  return layout(`
    <h2 style="margin:0 0 8px;font-size:18px">You&#39;ve Been Invited</h2>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 16px">
      <strong>${inviterName}</strong> has invited you to join
      <strong>${orgName}</strong> on Rhodes as a <strong>${role}</strong>.
    </p>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 24px;font-size:13px">
      Rhodes helps manage entities, track compliance, and process documents with AI — all in one place.
    </p>
    <a href="${inviteUrl}"
       style="display:inline-block;background:${BRAND.green};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Accept Invite
    </a>
    <p style="color:${BRAND.muted};font-size:12px;margin:16px 0 0;line-height:1.5">
      This invite expires in 7 days. If you weren&#39;t expecting this, you can ignore this email.
    </p>
  `);
}

export function entityDiscoveredEmail(entityName: string, docName: string) {
  return layout(`
    <h2 style="margin:0 0 8px;font-size:18px">New Entity Discovered</h2>
    <p style="color:${BRAND.muted};line-height:1.6;margin:0 0 16px">
      While processing <strong>${docName}</strong>, Rhodes identified a new entity:
      <strong>${entityName}</strong>. Review the discovery and decide whether to create it.
    </p>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://app.rhodesoffice.ai"}/documents"
       style="display:inline-block;background:${BRAND.green};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">
      Review Discovery
    </a>
  `);
}
