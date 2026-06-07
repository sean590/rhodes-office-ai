import { NextResponse } from "next/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { sendDocumentToProviderSchema } from "@/lib/validations";
import { sendDocumentToProvider, SendDocumentError } from "@/lib/providers/send-document";

// POST /api/provider-sends — send a bundle of stored documents to a provider as
// one secure link. Body validated by sendDocumentToProviderSchema (document_ids[]).
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json().catch(() => ({}));
    const parsed = sendDocumentToProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { data } = await sendDocumentToProvider(
      {
        document_ids: parsed.data.document_ids,
        provider_id: parsed.data.provider_id,
        recipient_email: parsed.data.recipient_email || null,
        subject: parsed.data.subject || null,
        message: parsed.data.message || null,
      },
      { orgId, userId: user.id, userEmail: user.email },
    );

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof SendDocumentError) {
      const status = err.code === "not_found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("POST /api/provider-sends error:", err);
    return NextResponse.json({ error: "Failed to send documents" }, { status: 500 });
  }
}
