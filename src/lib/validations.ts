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
  role: z.enum(["admin", "editor", "viewer"]),
});

export const inviteUserSchema = z.object({
  email: z.email("Invalid email address"),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
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
  entity_discovery: z.boolean().default(true),
});
