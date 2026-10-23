import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangeSetReview } from "../src/components/ChangeSetReview";
import type { Command } from "../src/scene/transformations/types";

function makeCommand(overrides: Partial<Command>): Command {
  return {
    id: Math.random().toString(36).slice(2),
    source: "voice",
    target: "nasal_bridge",
    parameter: "height",
    operation: "increase",
    value: 2,
    requested_value: 2,
    requested_unit: "mm",
    unit: "mm",
    direction: null,
    adjusted_value: null,
    confidence: 0.9,
    requires_confirmation: true,
    status: "ok",
    reason: null,
    original_text: "increase the bridge by 2 mm",
    parser: "rules",
    createdAt: 0,
    ...overrides,
  };
}

function noopProps() {
  return {
    editingIndex: null,
    onConfirm: vi.fn(),
    onConfirmValid: vi.fn(),
    onRejectAll: vi.fn(),
    onStartEdit: vi.fn(),
    onSaveEdit: vi.fn(),
    onPatch: vi.fn(),
    onRemove: vi.fn(),
  };
}

describe("ChangeSetReview", () => {
  it("requires a full change set to confirm, offering an explicit partial action", () => {
    const props = noopProps();
    render(
      <ChangeSetReview
        commands={[
          makeCommand({}),
          makeCommand({ status: "needs_clarification", value: null, reason: "missing" }),
        ]}
        {...props}
      />,
    );
    expect(screen.getByText("Change set")).toBeInTheDocument();
    expect(screen.getByText("Instruction 1")).toBeInTheDocument();
    expect(screen.getByText("Instruction 2")).toBeInTheDocument();

    // A change set is applied in full: confirm is disabled while any remains invalid.
    expect(screen.getByRole("button", { name: /Confirm & simulate/i })).toBeDisabled();

    // The partial action is explicit and only ever applies the valid subset.
    const applyValid = screen.getByRole("button", { name: /Apply only valid/i });
    expect(applyValid).toHaveTextContent("(1)");
    fireEvent.click(applyValid);
    expect(props.onConfirmValid).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("hides the partial action when every instruction is applicable", () => {
    const props = noopProps();
    render(
      <ChangeSetReview commands={[makeCommand({}), makeCommand({})]} {...props} />,
    );
    expect(screen.getByRole("button", { name: /Confirm & simulate/i })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Apply only valid/i }),
    ).not.toBeInTheDocument();
  });

  it("disables confirm when nothing can be applied", () => {
    render(
      <ChangeSetReview
        commands={[makeCommand({ status: "invalid", value: null })]}
        {...noopProps()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Confirm & simulate/i }),
    ).toBeDisabled();
  });

  it("invokes confirm when clicked", () => {
    const props = noopProps();
    render(<ChangeSetReview commands={[makeCommand({})]} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm & simulate/i }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("removes an instruction by index", () => {
    const props = noopProps();
    render(
      <ChangeSetReview commands={[makeCommand({}), makeCommand({})]} {...props} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove instruction 2" }));
    expect(props.onRemove).toHaveBeenCalledWith(1);
  });
});
