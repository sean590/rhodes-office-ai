/**
 * Chat endpoint path. MCP is the only path post-Phase-3 cutover.
 * The function signature is kept for now so call sites don't break;
 * a follow-up can inline "/api/chat" at each site and delete this file.
 */
export function chatEndpointForFlag(_mcpEnabled?: boolean | null): string {
  return "/api/chat";
}
