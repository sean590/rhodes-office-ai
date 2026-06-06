import { NextResponse } from "next/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { sendDocumentToProviderSchema } from "@/lib/validations";
import { sendDocumentToProvider, SendDocumentError } from "@/lib/providers/send-document";

// POST /api/documents/[id]/send — send a stored document to a service provider.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    // The [id] path segment is the document; body carries provider/recipient/message.
    const parsed = sendDocumentToProviderSchema.safeParse({ ...body, document_id: id });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { data } = await sendDocumentToProvider(
      {
        document_id: id,
        provider_id: parsed.data.provider_id,
        recipient_email: parsed.data.recipient_email || null,
        subject: parsed.data.subject || null,
        message: parsed.data.message || null,
      },
      { orgId, userId: user.id, userEmail: user.email },
    );

    // 200 with the send row; status field tells the caller sent vs failed.
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof SendDocumentError) {
      const status = err.code === "not_found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("POST /api/documents/[id]/send error:", err);
    return NextResponse.json({ error: "Failed to send document" }, { status: 500 });
  }
}
