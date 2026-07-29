/**
 * inbound/copy — the one place user-facing inbound strings live, shared by
 * the Home needs_user card and Settings → Mailbox (rhodes-inbound-v1-ui-spec
 * §1a/§3b/§4). Reason strings are human sentences, never the raw enum.
 */

/** The public forwarding address shown anywhere we ask the user to forward. */
export const INBOUND_ADDRESS = process.env.NEXT_PUBLIC_INBOUND_ADDRESS || "Rhodes@rdgcp.com";

/** One human sentence per needs_user_reason value — never the raw value. */
export function needsUserReasonSentence(reason: string | null): string {
  switch (reason) {
    case "portal/secure-delivery notification":
      return "Posted to a portal Rhodes can't sign in to — asked you to forward it.";
    case "known provider announcing a document":
      return "A provider says a document is ready somewhere Rhodes can't reach — asked you to forward it.";
    case "delivery-style message with link":
      return "Looks like a document is waiting behind a link — asked you to forward it.";
    case "SafeSend download link":
      return "A secure link Rhodes can't fetch yet — asked you to forward it.";
    default:
      return "Rhodes couldn't fetch this one — asked you to forward it.";
  }
}
