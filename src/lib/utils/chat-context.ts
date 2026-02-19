import { createClient } from "@/lib/supabase/server";

export async function buildChatContext() {
  const supabase = await createClient();

  const [
    entitiesRes,
    directoryRes,
    relationshipsRes,
    registrationsRes,
    managersRes,
    membersRes,
    trustDetailsRes,
    trustRolesRes,
    capTableRes,
    partnershipRepsRes,
    entityRolesRes,
  ] = await Promise.all([
    supabase.from("entities").select("*").order("name"),
    supabase.from("directory_entries").select("*").order("name"),
    supabase.from("relationships").select("*"),
    supabase.from("entity_registrations").select("*"),
    supabase.from("entity_managers").select("*"),
    supabase.from("entity_members").select("*"),
    supabase.from("trust_details").select("*"),
    supabase.from("trust_roles").select("*"),
    supabase.from("cap_table_entries").select("*"),
    supabase.from("entity_partnership_reps").select("*"),
    supabase.from("entity_roles").select("*"),
  ]);

  const entities = entitiesRes.data || [];
  const directory = directoryRes.data || [];
  const relationships = relationshipsRes.data || [];
  const registrations = registrationsRes.data || [];
  const managers = managersRes.data || [];
  const members = membersRes.data || [];
  const trustDetails = trustDetailsRes.data || [];
  const trustRoles = trustRolesRes.data || [];
  const capTable = capTableRes.data || [];
  const partnershipReps = partnershipRepsRes.data || [];
  const entityRoles = entityRolesRes.data || [];

  // Build entity name lookup
  const entityNames: Record<string, string> = {};
  for (const e of entities) entityNames[e.id] = e.name;
  const dirNames: Record<string, string> = {};
  for (const d of directory) dirNames[d.id] = d.name;

  let context = `You are an AI assistant for Plinth AI, a family office entity management platform. You have full knowledge of all entities, relationships, directory entries, compliance filings, and financial data in the system.

When referencing entities, always include their exact name so the UI can link to them.

## Entities (${entities.length} total)\n\n`;

  for (const entity of entities) {
    const entityRegs = registrations.filter(r => r.entity_id === entity.id);
    const entityManagers = managers.filter(m => m.entity_id === entity.id);
    const entityMembers = members.filter(m => m.entity_id === entity.id);
    const entityPartnershipReps = partnershipReps.filter(p => p.entity_id === entity.id);
    const entityEntityRoles = entityRoles.filter(r => r.entity_id === entity.id);
    const entityTrust = trustDetails.find(t => t.entity_id === entity.id);
    const entityCapTable = capTable.filter(c => c.entity_id === entity.id);

    context += `### ${entity.name}\n`;
    context += `- Type: ${entity.type.replace(/_/g, ' ')}, Status: ${entity.status}\n`;
    context += `- EIN: ${entity.ein || 'N/A'}, Formation State: ${entity.formation_state}`;
    if (entity.formed_date) context += `, Formed: ${entity.formed_date}`;
    context += '\n';
    if (entity.address) context += `- Address: ${entity.address}\n`;
    if (entity.registered_agent) context += `- Registered Agent: ${entity.registered_agent}\n`;

    if (entityRegs.length > 0) {
      context += `- Registered in: ${entityRegs.map(r => r.jurisdiction).join(', ')}\n`;
    }
    if (entityManagers.length > 0) {
      context += `- Managers: ${entityManagers.map(m => m.name).join(', ')}\n`;
    }
    if (entityMembers.length > 0) {
      context += `- Members: ${entityMembers.map(m => m.name).join(', ')}\n`;
    }
    if (entityPartnershipReps.length > 0) {
      context += `- Partnership Representatives: ${entityPartnershipReps.map(p => p.name).join(', ')}\n`;
    }
    if (entityEntityRoles.length > 0) {
      context += `- Roles: ${entityEntityRoles.map(r => `${r.role_title}: ${r.name}`).join('; ')}\n`;
    }
    if (entity.business_purpose) {
      context += `- Business Purpose: ${entity.business_purpose}\n`;
    }
    if (entityTrust) {
      context += `- Trust Type: ${entityTrust.trust_type}`;
      if (entityTrust.grantor_name) context += `, Grantor: ${entityTrust.grantor_name}`;
      if (entityTrust.situs_state) context += `, Situs: ${entityTrust.situs_state}`;
      context += '\n';

      const roles = trustRoles.filter(r => r.trust_detail_id === entityTrust.id);
      if (roles.length > 0) {
        context += `- Trust Roles: ${roles.map(r => `${r.role.replace(/_/g, ' ')}: ${r.name}`).join('; ')}\n`;
      }
    }
    if (entityCapTable.length > 0) {
      context += `- Cap Table: ${entityCapTable.map(c => `${c.investor_name || 'Unknown'} (${c.ownership_pct}%)`).join(', ')}\n`;
    }
    context += '\n';
  }

  context += `## Directory (${directory.length} entries)\n\n`;
  for (const entry of directory) {
    context += `- ${entry.name}`;
    if (entry.aliases && entry.aliases.length > 0) context += ` (AKA: ${entry.aliases.join(', ')})`;
    context += ` (${entry.type})`;
    if (entry.email) context += ` — ${entry.email}`;
    if (entry.phone) context += ` — ${entry.phone}`;
    context += '\n';
  }

  context += `\n## Relationships (${relationships.length} total)\n\n`;
  for (const rel of relationships) {
    const fromName = rel.from_entity_id ? entityNames[rel.from_entity_id] : (rel.from_directory_id ? dirNames[rel.from_directory_id] : 'Unknown');
    const toName = rel.to_entity_id ? entityNames[rel.to_entity_id] : (rel.to_directory_id ? dirNames[rel.to_directory_id] : 'Unknown');
    context += `- ${rel.type.replace(/_/g, ' ')}: ${fromName} → ${toName}`;
    if (rel.description) context += ` (${rel.description})`;
    if (rel.status) context += ` [${rel.status}]`;
    if (rel.annual_estimate) context += ` — $${(rel.annual_estimate / 100).toLocaleString()}/yr`;
    context += '\n';
  }

  context += `\nAnswer questions about entities, relationships, compliance, and organizational structure. Be specific and reference entity names exactly as they appear. If you don't know something, say so rather than guessing. Format your responses with clear structure using markdown.`;

  return context;
}
