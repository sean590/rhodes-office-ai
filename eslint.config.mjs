import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Tenant-isolation guard: the service-role admin client bypasses RLS, so
      // every raw createAdminClient() query must remember `.eq("organization_id")`.
      // Prefer createOrgClient(orgId), which stamps the org filter automatically.
      // This is a `warn` (not error) so the existing backlog doesn't break the
      // build; `scripts/check-admin-ratchet.sh` keeps the count from growing.
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              importNames: ["createAdminClient"],
              message:
                "Use createOrgClient(orgId) from @/lib/supabase/org-client for org-owned tables (auto-applies organization_id). Only reach for createAdminClient (or createOrgClient(orgId).raw) for auth, storage, child tables without an org column, or cross-org system jobs — and add `.eq(\"organization_id\", …)` yourself.",
            },
          ],
        },
      ],
    },
  },
  // The wrapper itself is the one legitimate importer of createAdminClient.
  {
    files: ["src/lib/supabase/org-client.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Legitimately-raw code — the org-scoped wrapper does NOT apply here, so the
  // createAdminClient guard is turned off for these paths (not a backlog):
  //  - src/lib/**            : system/service modules (run cross-org, get orgId
  //                            passed in, and touch child tables the wrapper
  //                            can't scope — e.g. the pipeline worker/agent).
  //  - cron/**               : system jobs, no per-user org context.
  //  - auth/** + auth/callback: auth/session flows over users/user_profiles.
  //  - organizations|users|invites|waitlist|admin|audit|health : operate on
  //                            NON-org tables (organizations/members/users/
  //                            audit_log) or are system/public endpoints.
  //  - share/**              : public, token-authenticated (no user org).
  //  - chat/** + home/staged : the chat subsystem keys on chat_messages (a
  //                            child of chat_sessions), not an org-scoped table.
  //  - directory/** + person-relationships + the entities/[id] child-row routes
  //                            (members/managers/roles/registrations/
  //                            partnership-reps/trust-*/joint-title*/cap-table/
  //                            custom-fields): child tables with no org column.
  {
    files: [
      "src/lib/**",
      "src/app/api/cron/**",
      "src/app/api/auth/**", // auth/session flows over users/user_profiles (incl. mfa-state)
      "src/app/auth/**",
      "src/app/api/organizations/**",
      "src/app/api/users/**",
      "src/app/api/invites/**",
      "src/app/api/waitlist/**",
      "src/app/api/admin/**",
      "src/app/api/audit/**",
      "src/app/api/health/**",
      "src/app/api/share/**",
      "src/app/share/**",
      "src/app/api/chat/**",
      "src/app/api/home/**",
      "src/app/api/directory/**",
      "src/app/api/person-relationships/**",
      "src/app/api/entities/*/members/**",
      "src/app/api/entities/*/managers/**",
      "src/app/api/entities/*/roles/**",
      "src/app/api/entities/*/registrations/**",
      "src/app/api/entities/*/partnership-reps/**",
      "src/app/api/entities/*/trust-details/**",
      "src/app/api/entities/*/trust-roles/**",
      "src/app/api/entities/*/joint-title-members/**",
      "src/app/api/entities/*/joint-titles/**",
      "src/app/api/entities/*/cap-table/**",
      "src/app/api/entities/*/custom-fields/**",
      // Only read the `users` table (created_by / permission lookups); the
      // queue mutation itself happens in an exempt lib helper.
      "src/app/api/pipeline/queue/*/approve/**",
      "src/app/api/pipeline/queue/*/ingest-only/**",
      "src/app/api/pipeline/queue/*/reject/**",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
