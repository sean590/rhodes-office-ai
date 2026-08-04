/**
 * Offboarding hard-delete cron (Increment B). Once an org is past its 30-day
 * grace, permanently purge it: storage files, then every org-scoped DB row (via
 * the hard_delete_organization RPC — triggers-off, order-independent, complete),
 * then the now-orphaned member auth accounts.
 *
 * The soft-delete → grace → hard-delete → (90-day S3 archive purge, separate
 * retention job) chain means an offboarded org is fully gone ~90 days after this.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const MAX_ORGS_PER_RUN = 5; // bound the blast radius / runtime per tick

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await admin
    .from("organizations")
    .select("id, name")
    .not("deleted_at", "is", null)
    .lt("deletion_scheduled_for", nowIso)
    .limit(MAX_ORGS_PER_RUN);

  if (!due?.length) return NextResponse.json({ purged: 0 });

  const results: Array<{ org: string; ok: boolean; files?: number; error?: string }> = [];

  for (const org of due) {
    try {
      // 1) Members to clean up afterwards (single-org → orphaned by the purge).
      const { data: members } = await admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", org.id);
      const memberIds = [...new Set((members ?? []).map((m) => m.user_id as string))];

      // 2) Storage: every stored file for the org lives under the `<org_id>/`
      // prefix. Gather known paths from documents + the queue and remove them.
      const [{ data: docs }, { data: qitems }] = await Promise.all([
        admin.from("documents").select("file_path").eq("organization_id", org.id),
        admin.from("document_queue").select("file_path").eq("organization_id", org.id),
      ]);
      const paths = [
        ...new Set(
          [...(docs ?? []), ...(qitems ?? [])]
            .map((r) => r.file_path as string | null)
            .filter((p): p is string => Boolean(p)),
        ),
      ];
      let filesRemoved = 0;
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await admin.storage.from("documents").remove(chunk);
        if (!error) filesRemoved += chunk.length;
        else console.error(`[hard-delete] storage remove failed for ${org.id}:`, error.message);
      }

      // 3) Purge every org-scoped DB row + the org itself (atomic, complete).
      const { error: rpcErr } = await admin.rpc("hard_delete_organization", { p_org: org.id });
      if (rpcErr) throw new Error(`rpc failed: ${rpcErr.message}`);

      // 4) Delete now-orphaned member auth accounts (only if they have no other
      // org — defensive; single-org means they never do).
      for (const uid of memberIds) {
        const { count } = await admin
          .from("organization_members")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid);
        if ((count ?? 0) === 0) {
          const { error: delErr } = await admin.auth.admin.deleteUser(uid);
          if (delErr) console.error(`[hard-delete] auth delete failed for ${uid}:`, delErr.message);
        }
      }

      console.log(`[hard-delete] purged org ${org.id} ("${org.name}"): ${filesRemoved} files, ${memberIds.length} members`);
      results.push({ org: org.id, ok: true, files: filesRemoved });
    } catch (err) {
      console.error(`[hard-delete] org ${org.id} failed:`, err);
      results.push({ org: org.id, ok: false, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  return NextResponse.json({ purged: results.filter((r) => r.ok).length, results });
}
