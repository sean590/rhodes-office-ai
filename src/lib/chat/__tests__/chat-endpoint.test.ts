import { describe, it, expect } from "vitest";
import { chatEndpointForFlag } from "../chat-endpoint";

describe("chatEndpointForFlag", () => {
  it("always returns /api/chat (MCP is the only path post-cutover)", () => {
    expect(chatEndpointForFlag(true)).toBe("/api/chat");
    expect(chatEndpointForFlag(false)).toBe("/api/chat");
    expect(chatEndpointForFlag(null)).toBe("/api/chat");
    expect(chatEndpointForFlag(undefined)).toBe("/api/chat");
  });
});
