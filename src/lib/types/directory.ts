import { DirectoryEntryType } from './enums';

export interface DirectoryEntry {
  id: string;
  name: string;
  type: DirectoryEntryType;
  email: string | null;
  created_at: string;
  updated_at: string;
  usage_count?: number;
  usage_details?: string;
}

export interface PicklistItem {
  id: string;
  name: string;
  type: 'directory' | 'entity';
  entry_type?: DirectoryEntryType;
  entity_type?: string;
}
