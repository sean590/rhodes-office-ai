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
  // Sort longest names first to avoid partial matches
  const sorted = [...refs].sort((a, b) => b.name.length - a.name.length);

  let result = html;
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
