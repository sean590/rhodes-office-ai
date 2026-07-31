import { describe, it, expect } from "vitest";
import { slugify, generateInboundAddress, normalizeRecipient, HOSTED_DOMAIN } from "../channels";

describe("slugify", () => {
  it("lowercases, hyphenates, and strips edge punctuation", () => {
    expect(slugify("Smith Family Office")).toBe("smith-family-office");
    expect(slugify("  O'Brien & Sons, LLC  ")).toBe("o-brien-sons-llc");
  });
  it("caps length and trims trailing hyphens", () => {
    expect(slugify("a".repeat(40)).length).toBeLessThanOrEqual(24);
  });
});

describe("generateInboundAddress", () => {
  it("produces an address on the hosted domain with a 16-char token", () => {
    const { address, recipientToken, localPart } = generateInboundAddress();
    expect(address).toBe(`${localPart}@${HOSTED_DOMAIN}`);
    expect(recipientToken).toMatch(/^[a-z2-7]{16}$/); // base32, unguessable
    expect(localPart).toBe(recipientToken); // no slug → token only
  });

  it("prefixes a friendly slug but keeps the token for routing", () => {
    const { localPart, recipientToken } = generateInboundAddress("Smith Family");
    expect(localPart).toBe(`smith-family-${recipientToken}`);
  });

  it("is unguessable — 1000 addresses are all unique (no enumeration)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateInboundAddress().recipientToken));
    expect(tokens.size).toBe(1000);
  });
});

describe("normalizeRecipient", () => {
  it("extracts the address from a display-name form and lowercases", () => {
    expect(normalizeRecipient("Rhodes Intake <Smith-X@Docs.RhodesOffice.ai>")).toBe(
      "smith-x@docs.rhodesoffice.ai",
    );
  });
  it("strips +tag sub-addressing so tagged mail still resolves", () => {
    expect(normalizeRecipient("smith-x+receipts@docs.rhodesoffice.ai")).toBe(
      "smith-x@docs.rhodesoffice.ai",
    );
  });
  it("passes through a plain address unchanged (lowercased)", () => {
    expect(normalizeRecipient("smith-x@docs.rhodesoffice.ai")).toBe("smith-x@docs.rhodesoffice.ai");
  });
});
