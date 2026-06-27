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
