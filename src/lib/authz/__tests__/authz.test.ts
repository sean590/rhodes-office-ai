import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { can, ROLE_CAPABILITIES } from "@/lib/authz/policy";
import { toolPermissionError } from "@/lib/mcp/schema";
import type { ToolDefinition } from "@/lib/mcp/schema";

// requireCapability builds on requireOrg — mock it, keep the real isError.
vi.mock("@/lib/utils/org-context", async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, requireOrg: vi.fn() };
});
import { requireOrg } from "@/lib/utils/org-context";
import { requireCapability, requireDelete, requireProviderSend } from "@/lib/utils/authz";

// ---- The policy matrix ------------------------------------------------------
describe("policy.can — the 3-role matrix", () => {
  it("member: read + write only (no delete/send/manage)", () => {
    expect(can("member", "records:read")).toBe(true);
    expect(can("member", "records:write")).toBe(true);
    expect(can("member", "records:delete")).toBe(false);
    expect(can("member", "providers:send")).toBe(false);
    expect(can("member", "members:manage")).toBe(false);
  });
  it("admin: + delete / send / manage / org:settings, but not owner-only", () => {
    expect(can("admin", "records:delete")).toBe(true);
    expect(can("admin", "providers:send")).toBe(true);
    expect(can("admin", "members:manage")).toBe(true);
    expect(can("admin", "org:settings")).toBe(true);
    expect(can("admin", "members:promote_admin")).toBe(false);
    expect(can("admin", "org:delete")).toBe(false);
    expect(can("admin", "billing:manage")).toBe(false);
  });
  it("owner: everything", () => {
    for (const cap of ROLE_CAPABILITIES.owner) expect(can("owner", cap)).toBe(true);
    expect(can("owner", "org:delete")).toBe(true);
    expect(can("owner", "billing:manage")).toBe(true);
  });
  it("viewer: nothing (unused fallback)", () => {
    expect(ROLE_CAPABILITIES.viewer.size).toBe(0);
    expect(can("viewer", "records:read")).toBe(false);
  });
});

// ---- MCP parity: toolPermissionError ---------------------------------------
describe("toolPermissionError — chat MCP tools obey the same matrix", () => {
  const del = { name: "archive_document", kind: "write", capability: "records:delete" } as ToolDefinition;
  const send = { name: "send_document_to_provider", kind: "write", capability: "providers:send" } as ToolDefinition;
  const write = { name: "update_document", kind: "write" } as ToolDefinition; // default records:write
  const read = { name: "get_document", kind: "read" } as ToolDefinition;

  it("member is denied delete + send, allowed plain writes", () => {
    expect(toolPermissionError(del, "member")).toMatch(/can't perform/);
    expect(toolPermissionError(send, "member")).toMatch(/an admin/);
    expect(toolPermissionError(write, "member")).toBeNull();
  });
  it("admin may delete + send", () => {
    expect(toolPermissionError(del, "admin")).toBeNull();
    expect(toolPermissionError(send, "admin")).toBeNull();
  });
  it("read tools are never gated", () => {
    expect(toolPermissionError(read, "viewer")).toBeNull();
  });
});

// ---- Route guards -----------------------------------------------------------
describe("requireCapability route guard", () => {
  const mockOrg = (orgRole: string) =>
    (requireOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u", orgRole },
      orgId: "o",
    });

  it("403s a member on a delete-gated route", async () => {
    mockOrg("member");
    const res = await requireDelete();
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });
  it("403s a member on a provider-send route", async () => {
    mockOrg("member");
    const res = await requireProviderSend();
    expect((res as NextResponse).status).toBe(403);
  });
  it("passes an admin through (returns the ctx, not a response)", async () => {
    mockOrg("admin");
    const res = await requireDelete();
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((res as { user: { orgRole: string } }).user.orgRole).toBe("admin");
  });
  it("propagates requireOrg's 401 unchanged (unauthenticated)", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    (requireOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(unauth);
    const res = await requireCapability("records:write");
    expect(res).toBe(unauth);
  });
});
