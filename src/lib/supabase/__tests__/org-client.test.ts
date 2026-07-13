import { describe, it, expect, vi, beforeEach } from "vitest";

// Records every call the wrapper makes to the underlying admin client so we can
// assert the org filter is auto-applied. A single recorder is reused per test.
interface Recorder {
  table?: string;
  op?: "select" | "insert" | "update" | "delete" | "upsert";
  selectCols?: string;
  selectOpts?: unknown;
  payload?: unknown;
  updateVals?: unknown;
  upsertOpts?: unknown;
  eqs: Array<{ col: string; val: unknown }>;
}
const rec: Recorder = { eqs: [] };
function reset() {
  rec.table = undefined;
  rec.op = undefined;
  rec.selectCols = undefined;
  rec.selectOpts = undefined;
  rec.payload = undefined;
  rec.updateVals = undefined;
  rec.upsertOpts = undefined;
  rec.eqs = [];
}

// A chainable stand-in for a PostgREST builder. `.eq` records and returns itself
// so further chaining (and the wrapper's auto `.eq`) works; it's also thenable
// so `await`ing the chain resolves to a fake result.
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  c.eq = (col: string, val: unknown) => {
    rec.eqs.push({ col, val });
    return c;
  };
  c.is = () => c;
  c.order = () => c;
  c.in = () => c;
  c.single = () => Promise.resolve({ data: null, error: null });
  c.maybeSingle = () => Promise.resolve({ data: null, error: null });
  c.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return c;
}

const fakeAdmin = {
  from: (table: string) => {
    rec.table = table;
    return {
      select: (cols: string, opts: unknown) => {
        rec.op = "select";
        rec.selectCols = cols;
        rec.selectOpts = opts;
        return chain();
      },
      insert: (payload: unknown) => {
        rec.op = "insert";
        rec.payload = payload;
        return chain();
      },
      update: (vals: unknown) => {
        rec.op = "update";
        rec.updateVals = vals;
        return chain();
      },
      delete: () => {
        rec.op = "delete";
        return chain();
      },
      upsert: (payload: unknown, opts: unknown) => {
        rec.op = "upsert";
        rec.payload = payload;
        rec.upsertOpts = opts;
        return chain();
      },
    };
  },
  storage: { from: () => ({}) },
  auth: {},
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdmin,
}));

import { createOrgClient } from "@/lib/supabase/org-client";

const ORG = "org-A";

describe("createOrgClient", () => {
  beforeEach(reset);

  it("requires an orgId", () => {
    expect(() => createOrgClient("")).toThrow(/orgId is required/);
  });

  it("auto-applies the org filter on select", () => {
    createOrgClient(ORG).from("documents").select("*");
    expect(rec.table).toBe("documents");
    expect(rec.eqs).toContainEqual({ col: "organization_id", val: ORG });
  });

  it("defaults select columns to '*'", () => {
    createOrgClient(ORG).from("entities").select();
    expect(rec.selectCols).toBe("*");
  });

  it("preserves caller filters AND adds the org filter", () => {
    createOrgClient(ORG).from("documents").select("*").eq("id", "doc-1");
    // both the caller's filter and the auto org filter must be present
    expect(rec.eqs).toContainEqual({ col: "id", val: "doc-1" });
    expect(rec.eqs).toContainEqual({ col: "organization_id", val: ORG });
  });

  it("injects organization_id into a single insert row", () => {
    createOrgClient(ORG).from("documents").insert({ name: "x" });
    expect(rec.payload).toEqual({ organization_id: ORG, name: "x" });
  });

  it("injects organization_id into every row of an array insert", () => {
    createOrgClient(ORG)
      .from("documents")
      .insert([{ name: "a" }, { name: "b" }]);
    expect(rec.payload).toEqual([
      { organization_id: ORG, name: "a" },
      { organization_id: ORG, name: "b" },
    ]);
  });

  it("forces the caller's org even if they pass a different organization_id", () => {
    createOrgClient(ORG)
      .from("documents")
      .insert({ name: "x", organization_id: "org-EVIL" });
    expect((rec.payload as { organization_id: string }).organization_id).toBe(ORG);
  });

  it("injects organization_id on upsert and forwards options", () => {
    createOrgClient(ORG)
      .from("compliance_profiles")
      .upsert({ key: "v" }, { onConflict: "organization_id,key" });
    expect(rec.payload).toEqual({ organization_id: ORG, key: "v" });
    expect(rec.upsertOpts).toEqual({ onConflict: "organization_id,key" });
  });

  it("auto-applies the org filter on update", () => {
    createOrgClient(ORG).from("documents").update({ name: "y" }).eq("id", "d1");
    expect(rec.op).toBe("update");
    expect(rec.updateVals).toEqual({ name: "y" });
    expect(rec.eqs).toContainEqual({ col: "organization_id", val: ORG });
  });

  it("auto-applies the org filter on delete", () => {
    createOrgClient(ORG).from("documents").delete().eq("id", "d1");
    expect(rec.op).toBe("delete");
    expect(rec.eqs).toContainEqual({ col: "organization_id", val: ORG });
  });

  it("THROWS when .from() is given a table without an organization_id column", () => {
    // child table — must go through .raw, not the scoped builder
    expect(() =>
      createOrgClient(ORG).from("entity_members" as never)
    ).toThrow(/not an org-scoped table/);
  });

  it("THROWS for tables deliberately excluded (audit_log, organization_members, document_types)", () => {
    const db = createOrgClient(ORG);
    expect(() => db.from("audit_log" as never)).toThrow(/not an org-scoped table/);
    expect(() => db.from("organization_members" as never)).toThrow(
      /not an org-scoped table/
    );
    expect(() => db.from("document_types" as never)).toThrow(
      /not an org-scoped table/
    );
  });

  it("exposes .raw as the unscoped admin client (escape hatch)", () => {
    const db = createOrgClient(ORG);
    expect(db.raw).toBe(fakeAdmin);
    // a .raw query applies NO automatic org filter
    db.raw.from("entity_members").select("*", undefined);
    expect(rec.eqs).toHaveLength(0);
  });

  it("exposes orgId", () => {
    expect(createOrgClient(ORG).orgId).toBe(ORG);
  });
});
