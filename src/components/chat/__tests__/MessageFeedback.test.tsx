// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MessageFeedback } from "../MessageFeedback";
import type { ChatMessage } from "@/lib/types/chat";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

function assistantMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    session_id: "s-1",
    role: "assistant",
    content: "An answer.",
    metadata: null,
    created_at: new Date().toISOString(),
    feedback: null,
    ...overrides,
  };
}

describe("<MessageFeedback />", () => {
  it("renders nothing for user messages", () => {
    const msg = assistantMessage({ role: "user" });
    const { container } = render(<MessageFeedback message={msg} />);
    expect(container.firstChild).toBeNull();
  });

  it("initial render shows two thumbs and no selection", () => {
    render(<MessageFeedback message={assistantMessage()} />);
    const up = screen.getByTestId("thumbs-up");
    const down = screen.getByTestId("thumbs-down");
    expect(up.getAttribute("aria-pressed")).toBe("false");
    expect(down.getAttribute("aria-pressed")).toBe("false");
    // Textarea not visible until thumbs-down is clicked.
    expect(screen.queryByTestId("feedback-comment-area")).toBeNull();
  });

  it("thumbs-up posts immediately with rating=up, comment=null", async () => {
    render(<MessageFeedback message={assistantMessage()} />);
    fireEvent.click(screen.getByTestId("thumbs-up"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/chat/feedback");
    const body = JSON.parse(call[1].body);
    expect(body.rating).toBe("up");
    expect(body.comment).toBeNull();
    // Thumbs-up becomes active.
    await waitFor(() =>
      expect(screen.getByTestId("thumbs-up").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("thumbs-down opens the comment textarea instead of posting immediately", async () => {
    render(<MessageFeedback message={assistantMessage()} />);
    fireEvent.click(screen.getByTestId("thumbs-down"));
    expect(screen.getByTestId("feedback-comment-area")).toBeTruthy();
    // No request fired yet — waiting for the user to hit Send.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posting thumbs-down with an empty comment still works (comment is optional)", async () => {
    render(<MessageFeedback message={assistantMessage()} />);
    fireEvent.click(screen.getByTestId("thumbs-down"));
    fireEvent.click(screen.getByTestId("submit-feedback"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.rating).toBe("down");
    expect(body.comment).toBeNull();
  });

  it("posting thumbs-down with a typed comment sends the trimmed text", async () => {
    render(<MessageFeedback message={assistantMessage()} />);
    fireEvent.click(screen.getByTestId("thumbs-down"));
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "  wrong entity  " } });
    fireEvent.click(screen.getByTestId("submit-feedback"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.rating).toBe("down");
    expect(body.comment).toBe("wrong entity");
  });

  it("renders the preloaded rating on mount when message.feedback is present", () => {
    const msg = assistantMessage({
      feedback: { rating: "down", comment: "said wrong year" },
    });
    render(<MessageFeedback message={msg} />);
    expect(screen.getByTestId("thumbs-down").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("thumbs-up").getAttribute("aria-pressed")).toBe("false");
  });

  it("re-clicking filled thumbs-up calls DELETE and clears to no-selection", async () => {
    const msg = assistantMessage({ feedback: { rating: "up", comment: null } });
    render(<MessageFeedback message={msg} />);
    expect(screen.getByTestId("thumbs-up").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("thumbs-up"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe("DELETE");
    const body = JSON.parse(call[1].body);
    expect(body.message_id).toBe(msg.id);
    expect(body.rating).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByTestId("thumbs-up").getAttribute("aria-pressed")).toBe("false"),
    );
  });

  it("re-clicking filled thumbs-down calls DELETE, clears rating, keeps textarea closed", async () => {
    const msg = assistantMessage({
      feedback: { rating: "down", comment: "said wrong year" },
    });
    render(<MessageFeedback message={msg} />);
    expect(screen.getByTestId("thumbs-down").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("thumbs-down"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    // Clearing must not reopen the comment drawer — fresh textarea only
    // appears when the user explicitly clicks down on an unfilled state.
    expect(screen.queryByTestId("feedback-comment-area")).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("thumbs-down").getAttribute("aria-pressed")).toBe("false"),
    );
  });

  it("clicking the OTHER thumb while one is filled POSTs the new rating (switch)", async () => {
    const msg = assistantMessage({ feedback: { rating: "up", comment: null } });
    render(<MessageFeedback message={msg} />);
    // Clicking down opens the textarea then requires Send — so the switch
    // flow still goes through the textarea for down. Verify by sending.
    fireEvent.click(screen.getByTestId("thumbs-down"));
    expect(screen.getByTestId("feedback-comment-area")).toBeTruthy();
    fireEvent.click(screen.getByTestId("submit-feedback"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.rating).toBe("down");
  });

  it("down→up switch POSTs up immediately (no textarea for up)", async () => {
    const msg = assistantMessage({
      feedback: { rating: "down", comment: "said wrong year" },
    });
    render(<MessageFeedback message={msg} />);
    fireEvent.click(screen.getByTestId("thumbs-up"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.rating).toBe("up");
    expect(body.comment).toBeNull();
  });

  it("DELETE failure shows an inline error and reverts to the prior filled state", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    const msg = assistantMessage({ feedback: { rating: "up", comment: null } });
    render(<MessageFeedback message={msg} />);
    fireEvent.click(screen.getByTestId("thumbs-up"));
    await waitFor(() =>
      expect(screen.getByText(/Couldn't clear feedback/)).toBeTruthy(),
    );
    // State reverted to pre-click.
    expect(screen.getByTestId("thumbs-up").getAttribute("aria-pressed")).toBe("true");
  });
});
