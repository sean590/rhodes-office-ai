import { redirect } from "next/navigation";

// The provider record is now part of the unified People record page
// (/people/[id]?type=provider). Kept as a redirect so old links — the entity
// People tab, bookmarks, notifications — keep resolving. (UX refresh Phase 6b-2)
export default async function ProviderDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/people/${id}?type=provider`);
}
