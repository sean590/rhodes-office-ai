import { describe, it, expect } from "vitest";
import { parseTargets, linkRow, isNoteTargetType, NOTE_TARGETS } from "../notes";

describe("isNoteTargetType", () => {
  it("accepts the four supported kinds and rejects others", () => {
    expect(isNoteTargetType("entity")).toBe(true);
    expect(isNoteTargetType("investment")).toBe(true);
    expect(isNoteTargetType("contact")).toBe(true);
    expect(isNoteTargetType("document")).toBe(true);
    expect(isNoteTargetType("relationship")).toBe(false);
    expect(isNoteTargetType("")).toBe(false);
  });
});

describe("parseTargets", () => {
  it("keeps valid typed targets and drops malformed/unknown ones", () => {
    const out = parseTargets([
      { type: "entity", id: "e1" },
      { type: "investment", id: "i1" },
      { type: "bogus", id: "x" },
      { type: "entity" }, // no id
      "nope",
    ]);
    expect(out).toEqual([
      { type: "entity", id: "e1" },
      { type: "investment", id: "i1" },
    ]);
  });

  it("dedupes repeated (type,id) pairs across the whole payload", () => {
    const out = parseTargets([
      { type: "contact", id: "c1" },
      { type: "contact", id: "c1" },
      { type: "contact", id: "c2" },
    ]);
    expect(out).toEqual([
      { type: "contact", id: "c1" },
      { type: "contact", id: "c2" },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(parseTargets(undefined)).toEqual([]);
    expect(parseTargets(null)).toEqual([]);
    expect(parseTargets({})).toEqual([]);
  });

  it("multi-object: one note can target several different kinds at once", () => {
    const out = parseTargets([
      { type: "entity", id: "e1" },
      { type: "investment", id: "i1" },
      { type: "contact", id: "c1" },
    ]);
    expect(out.map((t) => t.type)).toEqual(["entity", "investment", "contact"]);
  });
});

describe("linkRow", () => {
  it("sets exactly the one FK column for the target type", () => {
    expect(linkRow("n1", "org1", { type: "entity", id: "e1" })).toEqual({
      note_id: "n1",
      organization_id: "org1",
      entity_id: "e1",
    });
    expect(linkRow("n1", "org1", { type: "contact", id: "c1" })).toEqual({
      note_id: "n1",
      organization_id: "org1",
      directory_entry_id: "c1",
    });
  });

  it("the FK column name matches the NOTE_TARGETS mapping", () => {
    expect(NOTE_TARGETS.contact).toBe("directory_entry_id");
    expect(linkRow("n1", "org1", { type: "document", id: "d1" })[NOTE_TARGETS.document]).toBe("d1");
  });
});
