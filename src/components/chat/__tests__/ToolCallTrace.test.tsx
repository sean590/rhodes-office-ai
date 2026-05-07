// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  ToolCallTrace,
  summarizeToolCalls,
  humanizeToolName,
  classifyCalls,
} from "../ToolCallTrace";

afterEach(cleanup);

describe("humanizeToolName", () => {
  it("maps known tool names to plain-English labels", () => {
    expect(humanizeToolName("list_entities")).toBe("Searched entities");
    expect(humanizeToolName("get_portfolio_summary")).toBe("Computed a portfolio summary");
  });

  it("falls back to a de-underscored version for unknown tools", () => {
    expect(humanizeToolName("some_future_tool")).toBe("some future tool");
  });
});

describe("summarizeToolCalls", () => {
  it("deduplicates labels with a count suffix", () => {
    const out = summarizeToolCalls([
      { name: "list_entities", ok: true },
      { name: "list_entities", ok: true },
      { name: "list_entities", ok: true },
      { name: "get_entity", ok: true },
    ]);
    expect(out).toBe("Searched entities × 3 · Looked up an entity");
  });

  it("handles an empty list", () => {
    expect(summarizeToolCalls([])).toBe("No tools used");
  });
});

describe("<ToolCallTrace />", () => {
  it("renders a summary line by default, expanded details on click", () => {
    const calls = [
      { name: "list_entities", ok: true, duration_ms: 140 },
      { name: "get_entity", ok: true, duration_ms: 220 },
    ];
    render(<ToolCallTrace calls={calls} />);
    expect(screen.getByText(/Searched entities/)).toBeTruthy();
    // Collapsed by default — tool names aren't in the DOM yet.
    expect(screen.queryByText("list_entities")).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("list_entities")).toBeTruthy();
    expect(screen.getByText("get_entity")).toBeTruthy();
    expect(screen.getByText(/140ms/)).toBeTruthy();
  });

  it("annotates failed calls with their error", () => {
    const calls = [
      { name: "list_investments", ok: false, error: "column does not exist" },
    ];
    render(<ToolCallTrace calls={calls} />);
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/column does not exist/)).toBeTruthy();
  });

  it("renders nothing when the call list is empty", () => {
    const { container } = render(<ToolCallTrace calls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("collapses a failed call to 'retry succeeded' when a later same-name call succeeds", () => {
    // Mirrors the UUID-arg repro: first call fails Zod validation, the model
    // resolves via list_* then retries the same tool successfully. The failed
    // row should not count against the header badge and should render as
    // a subdued retry-succeeded note, not a red error.
    const calls = [
      {
        name: "get_entity_investment_summary",
        ok: false,
        error: "invalid_format uuid at path entity_id",
      },
      { name: "list_entities", ok: true, duration_ms: 201 },
      { name: "get_entity_investment_summary", ok: true, duration_ms: 532 },
    ];
    render(<ToolCallTrace calls={calls} />);
    // Header should NOT say "N failed" — the failure was transient.
    expect(screen.queryByText(/failed/)).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    // Failed call row shows "retry succeeded", not the raw Zod error text.
    expect(screen.getByText(/retry succeeded/)).toBeTruthy();
    expect(screen.queryByText(/invalid_format uuid/)).toBeNull();
  });

  it("still flags a terminal failure (no later success on same tool)", () => {
    const calls = [
      { name: "list_entities", ok: true, duration_ms: 140 },
      { name: "get_investment", ok: false, error: "not_found" },
    ];
    render(<ToolCallTrace calls={calls} />);
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/not_found/)).toBeTruthy();
  });
});

describe("classifyCalls", () => {
  it("marks a failure as transient when a later same-name call succeeds", () => {
    const { transientIdxs, terminalIdxs } = classifyCalls([
      { name: "get_entity_investment_summary", ok: false, error: "bad" },
      { name: "list_entities", ok: true },
      { name: "get_entity_investment_summary", ok: true },
    ]);
    expect(transientIdxs.has(0)).toBe(true);
    expect(terminalIdxs.has(0)).toBe(false);
  });

  it("marks a failure as terminal when no matching later success exists", () => {
    const { transientIdxs, terminalIdxs } = classifyCalls([
      { name: "list_entities", ok: true },
      { name: "get_investment", ok: false, error: "nope" },
    ]);
    expect(transientIdxs.has(1)).toBe(false);
    expect(terminalIdxs.has(1)).toBe(true);
  });

  it("does not treat an earlier success as recovery for a later failure", () => {
    // Order matters: recovery means "same tool succeeded AFTER this failure",
    // not "same tool succeeded anywhere in the trace".
    const { transientIdxs, terminalIdxs } = classifyCalls([
      { name: "get_investment", ok: true },
      { name: "get_investment", ok: false, error: "nope" },
    ]);
    expect(terminalIdxs.has(1)).toBe(true);
    expect(transientIdxs.has(1)).toBe(false);
  });
});
