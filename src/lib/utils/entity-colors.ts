import { EntityType } from '../types/enums';

interface EntityColorScheme {
  bg: string;
  border: string;
  text: string;
}

export const ENTITY_TYPE_COLORS: Record<EntityType, EntityColorScheme> = {
  holding_company: { bg: 'rgba(45,90,61,0.10)', border: '#2d5a3d', text: '#2d5a3d' },
  investment_fund: { bg: 'rgba(51,102,168,0.10)', border: '#3366a8', text: '#3366a8' },
  operating_company: { bg: 'rgba(45,138,78,0.10)', border: '#2d8a4e', text: '#2d8a4e' },
  real_estate: { bg: 'rgba(123,77,181,0.10)', border: '#7b4db5', text: '#7b4db5' },
  special_purpose: { bg: 'rgba(51,102,168,0.10)', border: '#3366a8', text: '#3366a8' },
  management_company: { bg: 'rgba(45,90,61,0.10)', border: '#2d5a3d', text: '#2d5a3d' },
  trust: { bg: 'rgba(196,117,32,0.10)', border: '#c47520', text: '#c47520' },
  other: { bg: 'rgba(148,148,160,0.10)', border: '#9494a0', text: '#9494a0' },
};

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  holding_company: 'Holding Company',
  investment_fund: 'Investment Fund',
  operating_company: 'Operating Company',
  real_estate: 'Real Estate',
  special_purpose: 'Special Purpose',
  management_company: 'Management Company',
  trust: 'Trust',
  other: 'Other',
};

export const RELATIONSHIP_TYPE_COLORS: Record<string, { label: string; color: string; bg: string }> = {
  profit_share: { label: 'Profit Share', color: '#1a6b35', bg: 'rgba(45,138,78,0.10)' },
  fixed_fee: { label: 'Fixed Fee', color: '#2a5a94', bg: 'rgba(51,102,168,0.10)' },
  management_fee: { label: 'Mgmt Fee', color: '#6b3fa3', bg: 'rgba(123,77,181,0.10)' },
  performance_fee: { label: 'Perf Fee', color: '#7b4db5', bg: 'rgba(123,77,181,0.10)' },
  equity: { label: 'Equity', color: '#2d5a3d', bg: 'rgba(45,90,61,0.08)' },
  loan: { label: 'Loan', color: '#a86218', bg: 'rgba(196,117,32,0.10)' },
  guarantee: { label: 'Guarantee', color: '#6b6b76', bg: 'rgba(107,107,118,0.10)' },
  service_agreement: { label: 'Service', color: '#3366a8', bg: 'rgba(51,102,168,0.10)' },
  license: { label: 'License', color: '#2d8a4e', bg: 'rgba(45,138,78,0.10)' },
  lease: { label: 'Lease', color: '#c47520', bg: 'rgba(196,117,32,0.10)' },
  other: { label: 'Other', color: '#6b6b76', bg: 'rgba(107,107,118,0.10)' },
};
