export interface LinkableRef {
  id: string;
  name: string;
  type: "entity" | "document" | "directory_entry";
  href: string;
}

/**
 * Injects clickable <a> links into rendered HTML for entity/document names.
 * Sorts by name length descending to avoid partial matches.
 * Skips text already inside HTML tags.
 */
export function linkifyReferences(html: string, refs: LinkableRef[]): string {
  // 1. First, resolve doc:UUID citation links from the AI — [text](doc:UUID)
  let result = linkifyDocumentCitations(html);

  // 2. Then, inject entity name links
  const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);

  for (const ref of sorted) {
    // Escape special regex chars in name
    const escaped = ref.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Only replace text outside of existing HTML tags
    const regex = new RegExp(`(?<![">])\\b(${escaped})\\b(?![<"])`, "g");
    result = result.replace(
      regex,
      `<a href="${ref.href}" data-ref-type="${ref.type}" data-ref-id="${ref.id}" ` +
        `style="color:#2d5a3d;font-weight:600;text-decoration:underline;` +
        `text-decoration-color:rgba(45,90,61,0.3);text-underline-offset:2px;cursor:pointer">` +
        `$1</a>`
    );
  }
  return result;
}

/**
 * Converts [Document Name](doc:UUID) citation links from AI output
 * into clickable download links.
 */
function linkifyDocumentCitations(html: string): string {
  // Match markdown-style links with doc: protocol that survived markdown rendering
  // After markdown rendering, these become <a href="doc:UUID">text</a>
  return html
    .replace(
      /<a href="doc:([a-f0-9-]+)"[^>]*>([^<]+)<\/a>/g,
      (_match, uuid: string, text: string) =>
        `<a href="/api/documents/${uuid}/download" target="_blank" data-ref-type="document" data-ref-id="${uuid}" ` +
        `style="color:#2d5a3d;font-weight:600;text-decoration:underline;` +
        `text-decoration-color:rgba(45,90,61,0.3);text-underline-offset:2px;cursor:pointer">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` +
        `${text}</a>`
    )
    // Also handle cases where markdown didn't convert it (raw text)
    .replace(
      /\[([^\]]+)\]\(doc:([a-f0-9-]+)\)/g,
      (_match, text: string, uuid: string) =>
        `<a href="/api/documents/${uuid}/download" target="_blank" data-ref-type="document" data-ref-id="${uuid}" ` +
        `style="color:#2d5a3d;font-weight:600;text-decoration:underline;` +
        `text-decoration-color:rgba(45,90,61,0.3);text-underline-offset:2px;cursor:pointer">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` +
        `${text}</a>`
    );
}
