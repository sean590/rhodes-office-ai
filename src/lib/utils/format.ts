// Money formatting: BIGINT cents -> display string
// 200000000 cents -> "$2.0M", 42000000 -> "$420K", 3000 -> "$30"
export function formatMoney(cents: number | null): string {
  if (cents === null || cents === undefined) return '$0';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toLocaleString()}`;
}

// EIN masking: "88-1234567" -> "***-**4567"
export function maskEin(ein: string | null): string {
  if (!ein) return '\u2014';
  const digits = ein.replace(/\D/g, '');
  if (digits.length < 4) return '***-*****';
  return `***-**${digits.slice(-4)}`;
}

// Date formatting
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
