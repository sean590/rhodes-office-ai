import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function getDbContext(supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never) {
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

  return {
    entities: entitiesRes.data || [],
    directory: directoryRes.data || [],
    relationships: relationshipsRes.data || [],
    registrations: registrationsRes.data || [],
    managers: managersRes.data || [],
    members: membersRes.data || [],
    trust_details: trustDetailsRes.data || [],
    trust_roles: trustRolesRes.data || [],
    cap_table: capTableRes.data || [],
    partnership_reps: partnershipRepsRes.data || [],
    entity_roles: entityRolesRes.data || [],
  };
}

function buildSystemPrompt(dbContext: Record<string, unknown[]>) {
  return `You are an AI assistant that analyzes legal and financial documents for a family office entity management platform called Plinth AI.

Your job is to read the document and propose specific, actionable changes to the database. You have full knowledge of the current database state.

## Current Database State

### Entities (${(dbContext.entities as Array<{id: string; name: string; type: string; ein: string | null; formation_state: string; status: string; business_purpose: string | null}>).length} total)
${(dbContext.entities as Array<{id: string; name: string; type: string; ein: string | null; formation_state: string; status: string; business_purpose: string | null}>).map((e) => `- ${e.name} (id: ${e.id}, type: ${e.type}, EIN: ${e.ein || 'N/A'}, state: ${e.formation_state}, status: ${e.status}${e.business_purpose ? `, purpose: ${e.business_purpose}` : ''})`).join('\n')}

### Directory Entries (${(dbContext.directory as Array<{id: string; name: string; type: string; email: string | null; aliases: string[] | null}>).length} total)
${(dbContext.directory as Array<{id: string; name: string; type: string; email: string | null; aliases: string[] | null}>).map((d) => `- ${d.name}${d.aliases && d.aliases.length > 0 ? ` (AKA: ${d.aliases.join(', ')})` : ''} (id: ${d.id}, type: ${d.type}, email: ${d.email || 'N/A'})`).join('\n')}

### Relationships (${(dbContext.relationships as unknown[]).length} total)
${(dbContext.relationships as Array<{id: string; type: string; from_entity_id: string | null; to_entity_id: string | null; description: string}>).map((r) => `- ${r.type}: ${r.from_entity_id} → ${r.to_entity_id} (${r.description || 'no description'})`).join('\n')}

### Registrations
${(dbContext.registrations as Array<{id: string; entity_id: string; jurisdiction: string; qualification_date: string | null; last_filing_date: string | null; state_id: string | null}>).map((r) => `- Entity ${r.entity_id}: ${r.jurisdiction} (registration_id: ${r.id}, qualification_date: ${r.qualification_date || 'N/A'}, last_filing_date: ${r.last_filing_date || 'N/A'}, state_id: ${r.state_id || 'N/A'})`).join('\n')}

### Managers
${(dbContext.managers as Array<{entity_id: string; name: string}>).map((m) => `- Entity ${m.entity_id}: ${m.name}`).join('\n')}

### Members
${(dbContext.members as Array<{entity_id: string; name: string}>).map((m) => `- Entity ${m.entity_id}: ${m.name}`).join('\n')}

### Trust Details
${(dbContext.trust_details as Array<{id: string; entity_id: string; trust_type: string; grantor_name: string | null}>).map((t) => `- Entity ${t.entity_id}: ${t.trust_type} trust, grantor: ${t.grantor_name || 'N/A'} (trust_detail_id: ${t.id})`).join('\n')}

### Trust Roles
${(dbContext.trust_roles as Array<{trust_detail_id: string; role: string; name: string}>).map((r) => `- Trust ${r.trust_detail_id}: ${r.role} = ${r.name}`).join('\n')}

### Cap Table
${(dbContext.cap_table as Array<{entity_id: string; investor_name: string | null; ownership_pct: number}>).map((c) => `- Entity ${c.entity_id}: ${c.investor_name || 'Unknown'} owns ${c.ownership_pct}%`).join('\n')}

### Partnership Representatives
${(dbContext.partnership_reps as Array<{entity_id: string; name: string}>).map((p) => `- Entity ${p.entity_id}: ${p.name}`).join('\n') || '(none)'}

### Entity Roles (VP, Controller, etc.)
${(dbContext.entity_roles as Array<{entity_id: string; role_title: string; name: string}>).map((r) => `- Entity ${r.entity_id}: ${r.role_title} = ${r.name}`).join('\n') || '(none)'}

## Response Format

You MUST respond with valid JSON only — no markdown, no explanation. Return an object with:

\`\`\`json
{
  "entity_id": "uuid of the primary existing entity this document is about, or null if proposing a new entity",
  "actions": [
    {
      "action": "create_entity" | "update_entity" | "create_relationship" | "add_member" | "add_manager" | "add_registration" | "update_registration" | "add_trust_role" | "update_trust_details" | "update_cap_table" | "create_directory_entry" | "add_custom_field" | "add_partnership_rep" | "add_role",
      "data": { ... },
      "reason": "Why this change is being proposed",
      "confidence": "high" | "medium" | "low"
    }
  ]
}
\`\`\`

IMPORTANT: Always set "entity_id" to the UUID of the existing entity this document primarily belongs to. This is used to associate the document with the correct entity. Even if you have zero proposed actions (all data is already up to date), you MUST still identify the entity. Only set it to null if the document is about a brand new entity that needs to be created.

### Action Data Schemas:

- **create_entity**: { "name": string, "type": "holding_company"|"investment_fund"|"operating_company"|"real_estate"|"special_purpose"|"management_company"|"trust"|"other", "ein": string|null, "formation_state": "XX", "formed_date": "YYYY-MM-DD"|null, "address": string|null, "registered_agent": string|null, "notes": string|null, "business_purpose": string|null }
- **update_entity**: { "entity_id": "uuid", "fields": { field: value, ... } }
- **create_relationship**: { "from_entity_id": "uuid"|null, "from_directory_id": "uuid"|null, "to_entity_id": "uuid"|null, "to_directory_id": "uuid"|null, "type": "profit_share"|"fixed_fee"|"management_fee"|"performance_fee"|"equity"|"loan"|"guarantee"|"service_agreement"|"license"|"lease"|"other", "description": string, "terms": string|null, "frequency": "one_time"|"monthly"|"quarterly"|"semi_annual"|"annual"|"upon_event"|"na"|null, "annual_estimate": number|null }
- **add_member**: { "entity_id": "uuid", "name": string }
- **add_manager**: { "entity_id": "uuid", "name": string }
- **add_registration**: { "entity_id": "uuid", "jurisdiction": "XX", "qualification_date": "YYYY-MM-DD"|null, "last_filing_date": "YYYY-MM-DD"|null, "state_id": string|null }
- **update_registration**: { "registration_id": "uuid", "qualification_date": "YYYY-MM-DD"|null, "last_filing_date": "YYYY-MM-DD"|null, "state_id": string|null }
- **add_trust_role**: { "trust_detail_id": "uuid", "role": "grantor"|"trustee"|"successor_trustee"|"beneficiary"|"contingent_beneficiary"|"trust_protector"|"enforcer"|"investment_advisor"|"distribution_advisor"|"trust_counsel", "name": string }
- **update_trust_details**: { "entity_id": "uuid", "trust_type": "revocable"|"irrevocable"|null, "trust_date": "YYYY-MM-DD"|null, "grantor_name": string|null, "situs_state": "XX"|null }
- **update_cap_table**: { "entity_id": "uuid", "investor_name": string, "investor_type": "individual"|"entity"|"external_fund"|"family_office"|"institutional"|"trust"|"other", "units": number|null, "ownership_pct": number, "capital_contributed": number|null, "replaces_investor_name": string|null }
- **create_directory_entry**: { "name": string, "type": "individual"|"external_entity"|"trust", "email": string|null }
- **add_custom_field**: { "entity_id": "uuid", "label": string, "value": string }
- **add_partnership_rep**: { "entity_id": "uuid", "name": string }
- **add_role**: { "entity_id": "uuid", "role_title": string, "name": string }

### Guidelines:
- Match entity names to existing entities by name when possible. Use the entity's UUID in your data.
- IMPORTANT: If you are proposing a "create_entity" action AND also proposing other actions (add_member, add_manager, add_registration, update_cap_table, add_trust_role, add_role, add_partnership_rep, add_custom_field, etc.) that reference the new entity, use "new_entity" as the entity_id placeholder. The system will automatically replace "new_entity" with the real UUID once the entity is created.
- Match people/organizations to existing directory entries by name OR by their aliases (AKA names). For example, if a directory entry has name "Sean Demetree" with AKA "S. Demetree", a document referencing "S. Demetree" should use that existing directory entry's UUID, NOT propose a new one.
- If a person is mentioned who doesn't exist in the directory (and doesn't match any aliases), propose creating a directory entry AND then reference their role.
- For dollar amounts in cap table, convert to cents (integer). E.g., $100,000 = 10000000.
- When ownership is being transferred or updated (e.g., from one person to a married couple), use "replaces_investor_name" in the update_cap_table action to specify the old investor being replaced. This removes the old entry and creates the new one.
- Set confidence to "high" when the document clearly states something, "medium" when you're inferring, "low" when guessing.
- Don't propose changes that would duplicate existing data.
- For compliance/filing documents (annual reports, statements of information, certificates of good standing, etc.): if the entity already has a registration for that jurisdiction, use "update_registration" with the existing registration_id. If the entity does NOT have a registration for that jurisdiction, use "add_registration" and include the filing details (last_filing_date, qualification_date, state_id) directly — do NOT create a separate update_registration action for a registration that doesn't exist yet.
- For franchise tax payments (including CA Form 3522, CA Form 3536, CA Form 100-ES, and similar state tax payments): use "update_registration" to set the last_filing_date to the payment date on the registration for the corresponding jurisdiction. This marks the entity as current on its filing obligations for that state.
- For non-trust entities: if a document mentions the entity's business purpose (e.g. "formed for the purpose of..."), propose an update_entity with business_purpose in the fields, or include business_purpose when creating a new entity.
- For partnership representatives (designated partnership rep, tax matters partner, etc.), use "add_partnership_rep". For other officer/role titles (VP, Controller, Secretary, Treasurer, President, CFO, COO, Authorized Signatory, etc.), use "add_role" with the appropriate role_title. Do NOT use these for trust entities — trust entities use trust roles instead.
- Be thorough but don't over-propose. Focus on concrete, verifiable facts from the document.`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    // Get document record
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Download the file from storage using admin client
    const { data: fileData, error: downloadError } = await admin.storage
      .from("documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
    }

    // Get DB context
    const dbContext = await getDbContext(supabase);

    // Build the Claude API request
    const systemPrompt = buildSystemPrompt(dbContext);

    // Determine how to send the document to Claude
    const isPdf = doc.mime_type === 'application/pdf';
    const isImage = doc.mime_type?.startsWith('image/');

    let userContent: unknown[];

    if (isPdf) {
      // Send PDF as base64 document
      const buffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      userContent = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        },
        {
          type: "text",
          text: `Analyze this ${doc.document_type.replace(/_/g, ' ')} document and propose database changes. The document is named "${doc.name}"${doc.year ? ` and is from year ${doc.year}` : ''}.${doc.notes ? ` Notes: ${doc.notes}` : ''}`,
        },
      ];
    } else if (isImage) {
      const buffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      userContent = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: doc.mime_type,
            data: base64,
          },
        },
        {
          type: "text",
          text: `Analyze this ${doc.document_type.replace(/_/g, ' ')} document image and propose database changes. The document is named "${doc.name}"${doc.year ? ` and is from year ${doc.year}` : ''}.${doc.notes ? ` Notes: ${doc.notes}` : ''}`,
        },
      ];
    } else {
      // Text-based file — read as text
      const text = await fileData.text();
      userContent = [
        {
          type: "text",
          text: `Analyze this ${doc.document_type.replace(/_/g, ' ')} document and propose database changes.

Document name: "${doc.name}"${doc.year ? `\nYear: ${doc.year}` : ''}${doc.notes ? `\nNotes: ${doc.notes}` : ''}

Document content:
---
${text}
---`,
        },
      ];
    }

    // Call Claude API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI processing not configured" }, { status: 500 });
    }

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(isPdf ? { "anthropic-beta": "pdfs-2024-09-25" } : {}),
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errorText);
      let detail = "AI processing failed";
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed?.error?.message || detail;
      } catch { /* use default */ }
      return NextResponse.json({ error: detail }, { status: 500 });
    }

    const claudeResult = await claudeResponse.json();
    const responseText = claudeResult.content?.[0]?.text || "[]";

    // Parse the response — Claude should return JSON object with entity_id + actions
    let proposedActions: unknown[] = [];
    let identifiedEntityId: string | null = null;
    try {
      // Strip any markdown code fences if present
      const cleanJson = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      // Support both new object format { entity_id, actions } and legacy array format
      if (Array.isArray(parsed)) {
        proposedActions = parsed;
      } else if (parsed && typeof parsed === 'object') {
        identifiedEntityId = parsed.entity_id || null;
        proposedActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      }
    } catch {
      console.error("Failed to parse Claude response:", responseText);
      proposedActions = [];
    }

    // Auto-associate document with identified entity if it doesn't have one
    const docUpdate: Record<string, unknown> = {
      ai_extracted: true,
      ai_extraction: { actions: proposedActions, identified_entity_id: identifiedEntityId },
      ai_extracted_at: new Date().toISOString(),
    };
    if (!doc.entity_id && identifiedEntityId) {
      docUpdate.entity_id = identifiedEntityId;
    }

    const { error: updateError } = await admin
      .from("documents")
      .update(docUpdate)
      .eq("id", id);

    if (updateError) {
      console.error("Failed to save AI extraction:", updateError);
    }

    return NextResponse.json({
      status: "processed",
      actions: proposedActions,
      entity_id: identifiedEntityId,
    });
  } catch (err) {
    console.error("POST /api/documents/[id]/process error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
