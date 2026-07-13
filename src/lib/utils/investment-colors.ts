import type { InvestmentType, InvestmentStatus } from '../types/investments';

interface ColorScheme {
  bg: string;
  border: string;
  text: string;
}

export const INVESTMENT_TYPE_COLORS: Record<InvestmentType, ColorScheme> = {
  real_estate: { bg: 'rgba(123,77,181,0.10)', border: '#7b4db5', text: '#7b4db5' },
  startup: { bg: 'rgba(45,138,78,0.10)', border: '#2d8a4e', text: '#2d8a4e' },
  fund: { bg: 'rgba(51,102,168,0.10)', border: '#3366a8', text: '#3366a8' },
  private_equity: { bg: 'rgba(45,90,61,0.10)', border: '#2d5a3d', text: '#2d5a3d' },
  debt: { bg: 'rgba(196,117,32,0.10)', border: '#c47520', text: '#c47520' },
  other: { bg: 'rgba(148,148,160,0.10)', border: '#9494a0', text: '#9494a0' },
};

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  real_estate: 'Real Estate',
  startup: 'Startup',
  fund: 'Fund',
  private_equity: 'Private Equity',
  debt: 'Debt',
  other: 'Other',
};

export const INVESTMENT_STATUS_COLORS: Record<InvestmentStatus, ColorScheme> = {
  active: { bg: 'rgba(45,138,78,0.10)', border: '#2d8a4e', text: '#2d8a4e' },
  exited: { bg: 'rgba(148,148,160,0.10)', border: '#9494a0', text: '#9494a0' },
  winding_down: { bg: 'rgba(196,117,32,0.10)', border: '#c47520', text: '#c47520' },
  committed: { bg: 'rgba(51,102,168,0.10)', border: '#3366a8', text: '#3366a8' },
  defaulted: { bg: 'rgba(199,62,62,0.10)', border: '#c73e3e', text: '#c73e3e' },
};

export const INVESTMENT_STATUS_LABELS: Record<InvestmentStatus, string> = {
  active: 'Active',
  exited: 'Exited',
  winding_down: 'Winding Down',
  committed: 'Committed',
  defaulted: 'Defaulted',
};
