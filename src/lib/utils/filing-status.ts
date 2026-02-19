import { FilingStatus, Jurisdiction } from '../types/enums';

interface FilingStatusResult {
  status: FilingStatus;
  label: string;
  nextDue: Date | null;
}

// State filing frequencies in months
const STATE_FILING_FREQ: Record<string, { name: string; months: number }> = {
  DE: { name: 'Annual Franchise Tax', months: 12 },
  CA: { name: 'Statement of Information', months: 24 },
  FL: { name: 'Annual Report', months: 12 },
  NY: { name: 'Biennial Statement', months: 24 },
  TX: { name: 'Annual Franchise Tax', months: 12 },
  NV: { name: 'Annual List', months: 12 },
  IL: { name: 'Annual Report', months: 12 },
  GA: { name: 'Annual Registration', months: 12 },
  NJ: { name: 'Annual Report', months: 12 },
  WA: { name: 'Annual Report', months: 12 },
  CO: { name: 'Periodic Report', months: 12 },
  MA: { name: 'Annual Report', months: 12 },
  OH: { name: 'N/A', months: 0 },
  PA: { name: 'Decennial Report', months: 120 },
};

export function getFilingInfo(jurisdiction: Jurisdiction): { name: string; months: number } {
  return STATE_FILING_FREQ[jurisdiction] || { name: 'Annual Report', months: 12 };
}

export function getNextFilingDate(lastFiled: string | null, jurisdiction: Jurisdiction): Date | null {
  if (!lastFiled) return null;
  const info = getFilingInfo(jurisdiction);
  if (info.months === 0) return null; // No filing required (e.g., Ohio)
  const d = new Date(lastFiled);
  d.setMonth(d.getMonth() + info.months);
  return d;
}

export function calculateFilingStatus(lastFiled: string | null, jurisdiction: Jurisdiction, filingExempt?: boolean): FilingStatusResult {
  if (filingExempt) {
    return { status: 'not_required', label: 'Exempt', nextDue: null };
  }
  const info = getFilingInfo(jurisdiction);
  if (info.months === 0) {
    return { status: 'not_required', label: 'Not required', nextDue: null };
  }
  const nextDue = getNextFilingDate(lastFiled, jurisdiction);
  if (!nextDue) {
    return { status: 'overdue', label: 'No data', nextDue: null };
  }
  const now = new Date();
  const diffDays = (nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {
    return {
      status: 'overdue',
      label: `Overdue (was ${nextDue.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })})`,
      nextDue,
    };
  }
  if (diffDays < 60) {
    return {
      status: 'due_soon',
      label: `Due ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
      nextDue,
    };
  }
  return {
    status: 'current',
    label: `Next: ${nextDue.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    nextDue,
  };
}

// Get worst filing status across multiple jurisdictions
export function getWorstFilingStatus(statuses: FilingStatusResult[]): FilingStatus {
  if (statuses.some(s => s.status === 'overdue')) return 'overdue';
  if (statuses.some(s => s.status === 'due_soon')) return 'due_soon';
  return 'current';
}
