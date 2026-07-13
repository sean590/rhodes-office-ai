/**
 * MCP chat is now the only chat path (Phase 3-4 cutover complete).
 * These stubs exist so call sites don't need to be updated in this PR;
 * they always return true. A future PR can inline `true` at each call
 * site and delete this file.
 */
export function isMcpChatEnabled(_userId?: string): boolean {
  return true;
}

export function isMcpWritesEnabled(_userId?: string): boolean {
  return true;
}
