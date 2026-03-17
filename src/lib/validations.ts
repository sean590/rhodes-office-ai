import { z } from "zod";

export const createEntitySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.string().min(1, "Type is required"),
  formation_state: z.string().min(1, "Formation state is required"),
  short_name: z.string().min(1, "Short name is required").max(50),
  ein: z.string().regex(/^\d{2}-?\d{7}$/, "Invalid EIN format").optional().or(z.literal("")),
  formed_date: z.string().optional().or(z.literal("")),
  registered_agent: z.string().max(255).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  parent_entity_id: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  legal_structure: z.string().optional().or(z.literal("")),
});

export const updateEntitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.string().optional(),
  formation_state: z.string().optional(),
  short_name: z.string().min(1).max(50).optional(),
  ein: z.string().regex(/^\d{2}-?\d{7}$/).optional().nullable(),
  formed_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  registered_agent: z.string().max(255).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  parent_entity_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.enum(["active", "inactive", "dissolved"]).optional(),
  legal_structure: z.string().optional().nullable(),
  business_purpose: z.string().max(1000).optional().nullable(),
});

export const userRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

export const inviteUserSchema = z.object({
  email: z.email("Invalid email address"),
  role: z.enum(["admin", "member", "viewer"]).default("viewer"),
});

export const chatMessageSchema = z.object({
  session_id: z.string().uuid("Invalid session ID"),
  message: z.string().min(1, "Message is required").max(10000),
  page_context: z.object({
    page: z.string(),
    entityId: z.string().optional(),
    entityName: z.string().optional(),
    documentId: z.string().optional(),
    filters: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

export const createBatchSchema = z.object({
  name: z.string().max(255).optional(),
  context: z.enum(["global", "entity", "onboarding"]).default("global"),
  entity_id: z.string().uuid().optional().nullable(),
  entity_discovery: z.boolean().default(false),
});

// --- Additional mutation schemas ---

export const createRelationshipSchema = z.object({
  type: z.string().min(1, "Type is required").max(100),
  description: z.string().max(1000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  from_entity_id: z.string().uuid().optional().nullable(),
  from_directory_id: z.string().uuid().optional().nullable(),
  to_entity_id: z.string().uuid().optional().nullable(),
  to_directory_id: z.string().uuid().optional().nullable(),
  frequency: z.string().max(50).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  effective_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  annual_estimate: z.number().int().optional().nullable(),
  document_ref: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateRelationshipSchema = createRelationshipSchema.partial();

export const createDirectoryEntrySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.string().min(1, "Type is required").max(100),
  email: z.string().email().optional().nullable().or(z.literal("")),
  aliases: z.array(z.string().max(255)).max(20).optional(),
});

export const updateDirectoryEntrySchema = createDirectoryEntrySchema.partial();

export const createRegistrationSchema = z.object({
  jurisdiction: z.string().min(1, "Jurisdiction is required").max(100),
});

export const updateRegistrationSchema = z.object({
  registration_id: z.string().uuid(),
  last_filing_date: z.string().optional().nullable(),
  qualification_date: z.string().optional().nullable(),
  state_id: z.string().max(100).optional().nullable(),
  filing_exempt: z.boolean().optional(),
});

export const createCapTableEntrySchema = z.object({
  investor_name: z.string().max(255).optional().nullable(),
  investor_type: z.string().max(50).optional().nullable(),
  units: z.number().optional().nullable(),
  ownership_pct: z.number().min(0).max(100).optional().nullable(),
  capital_contributed: z.number().int().optional().nullable(),
  investment_date: z.string().optional().nullable(),
  investor_entity_id: z.string().uuid().optional().nullable(),
  investor_directory_id: z.string().uuid().optional().nullable(),
});

export const entityPersonRefSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const deleteByIdSchema = z.object({
  member_id: z.string().uuid().optional(),
  manager_id: z.string().uuid().optional(),
  role_id: z.string().uuid().optional(),
  partnership_rep_id: z.string().uuid().optional(),
  entry_id: z.string().uuid().optional(),
  registration_id: z.string().uuid().optional(),
  field_def_id: z.string().uuid().optional(),
});

export const updateComplianceSchema = z.object({
  status: z.enum(["pending", "completed", "overdue", "not_applicable"]).optional(),
  completed_at: z.string().optional().nullable(),
  completed_by: z.string().max(255).optional().nullable(),
  payment_amount: z.number().int().optional().nullable(),
  confirmation: z.string().max(500).optional().nullable(),
  document_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const updateTrustDetailsSchema = z.object({
  trust_type: z.string().max(100).optional(),
  trust_date: z.string().optional().nullable(),
  grantor_name: z.string().max(255).optional().nullable(),
  situs_state: z.string().max(100).optional().nullable(),
});

export const createTrustRoleSchema = z.object({
  role: z.string().min(1, "Role is required").max(100),
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const createEntityRoleSchema = z.object({
  role_title: z.string().min(1, "Role title is required").max(255),
  name: z.string().min(1, "Name is required").max(255),
  directory_entry_id: z.string().uuid().optional().nullable(),
  ref_entity_id: z.string().uuid().optional().nullable(),
});

export const createCustomFieldSchema = z.object({
  label: z.string().min(1, "Label is required").max(255),
  field_type: z.string().min(1).max(50),
  value: z.string().max(5000).optional().nullable(),
});

// File upload validation
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.ms-excel", // .xls
]);

export function validateUploadedFile(file: File): { valid: true } | { valid: false; error: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File "${file.name}" exceeds the 50MB size limit` };
  }
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return { valid: false, error: `File type "${file.type}" is not allowed` };
  }
  return { valid: true };
}
