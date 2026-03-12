/**
 * Fuzzy name matching that accounts for:
 * - Case differences ("Sean" vs "sean")
 * - Punctuation in initials ("Sean P." vs "Sean P")
 * - Extra whitespace
 * - Directory aliases
 */

/** Normalize a name for comparison: lowercase, strip periods, collapse whitespace */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")     // "P." → "P"
    .replace(/,/g, "")      // "Jr," → "Jr"
    .replace(/\s+/g, " ")   // collapse whitespace
    .trim();
}

interface DirectoryEntry {
  id: string;
  name: string;
  aliases?: string[] | null;
}

/**
 * Find a directory entry that matches the given name.
 * Checks the directory entry's name and all aliases using normalized comparison.
 */
export function findDirectoryMatch(
  name: string,
  directory: DirectoryEntry[]
): DirectoryEntry | null {
  const normalized = normalizeName(name);

  for (const entry of directory) {
    // Check primary name
    if (normalizeName(entry.name) === normalized) return entry;

    // Check aliases
    if (entry.aliases) {
      for (const alias of entry.aliases) {
        if (normalizeName(alias) === normalized) return entry;
      }
    }
  }

  return null;
}

/**
 * Check if two names match after normalization.
 */
export function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
