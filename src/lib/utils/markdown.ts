/**
 * Minimal markdown-to-HTML for assistant messages.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, ### headings,
 * - bullet lists, numbered lists, \n\n paragraphs
 */
export function renderMarkdown(text: string): string {
  const html = text
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks (```)
    .replace(
      /```([\s\S]*?)```/g,
      '<pre style="background:#f0eeea;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto;margin:8px 0;font-family:monospace">$1</pre>'
    )
    // Inline code
    .replace(
      /`([^`]+)`/g,
      '<code style="background:#f0eeea;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>'
    )
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Headings
    .replace(
      /^### (.+)$/gm,
      '<div style="font-weight:700;font-size:14px;margin:12px 0 4px">$1</div>'
    )
    .replace(
      /^## (.+)$/gm,
      '<div style="font-weight:700;font-size:15px;margin:14px 0 6px">$1</div>'
    )
    .replace(
      /^# (.+)$/gm,
      '<div style="font-weight:700;font-size:16px;margin:16px 0 6px">$1</div>'
    )
    // Bullet lists
    .replace(
      /^- (.+)$/gm,
      '<div style="padding-left:16px;position:relative;margin:2px 0"><span style="position:absolute;left:4px">\u2022</span>$1</div>'
    )
    // Numbered lists
    .replace(
      /^(\d+)\. (.+)$/gm,
      '<div style="padding-left:20px;position:relative;margin:2px 0"><span style="position:absolute;left:0;font-weight:600">$1.</span>$2</div>'
    )
    // Line breaks (double newline = paragraph break, single = <br>)
    .replace(/\n\n/g, '<div style="margin:10px 0"></div>')
    .replace(/\n/g, "<br>");

  return html;
}
