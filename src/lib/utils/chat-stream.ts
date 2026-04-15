/**
 * Result event from the chat stream (proposed actions, approval cards).
 */
export interface ChatStreamResult {
  type: "results";
  message_id: string | null;
  summary: string;
  attachments: unknown[];
  proposed_actions: unknown[];
  [key: string]: unknown;
}

/**
 * Reads an SSE stream from the chat API and yields text deltas.
 * Returns the full assembled text and any results event when the stream closes.
 */
export async function readChatStream(
  response: Response,
  onDelta: (fullText: string) => void
): Promise<{ text: string; result?: ChatStreamResult }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let resultEvent: ChatStreamResult | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.text) {
            fullText += parsed.text;
            onDelta(fullText);
          }
          if (parsed.type === "results") {
            resultEvent = parsed as ChatStreamResult;
          }
        } catch {
          // Skip unparseable
        }
      }
    }
  }

  return { text: fullText, result: resultEvent };
}
