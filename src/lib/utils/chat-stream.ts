/**
 * Reads an SSE stream from the chat API and yields text deltas.
 * Returns the full assembled text when the stream closes.
 */
export async function readChatStream(
  response: Response,
  onDelta: (fullText: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

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
        } catch {
          // Skip unparseable
        }
      }
    }
  }

  return fullText;
}
