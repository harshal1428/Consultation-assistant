import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConsultationHistoryPanel } from "../src/components/ConsultationHistoryPanel";
import type { ArchivedConsultation } from "../src/lib/historyStore";
import { resetModel } from "../src/scene/transformations/logic";

function entry(overrides: Partial<ArchivedConsultation> = {}): ArchivedConsultation {
  return {
    id: "a",
    label: "Consultation 09:00",
    savedAt: Date.now(),
    startedAt: Date.now() - 1000,
    status: "ended",
    changeCount: 3,
    scenarioCount: 2,
    modelState: resetModel(),
    summary: "#",
    ...overrides,
  };
}

describe("ConsultationHistoryPanel", () => {
  it("shows an empty state with a local-only note", () => {
    render(
      <ConsultationHistoryPanel
        entries={[]}
        canArchive
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/No saved consultations yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/never uploaded/i).length).toBeGreaterThanOrEqual(1);
  });

  it("disables archiving when there is nothing to save", () => {
    render(
      <ConsultationHistoryPanel
        entries={[]}
        canArchive={false}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Archive current/i })).toBeDisabled();
  });

  it("archives on request", () => {
    const onArchive = vi.fn();
    render(
      <ConsultationHistoryPanel
        entries={[]}
        canArchive
        onArchive={onArchive}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Archive current/i }));
    expect(onArchive).toHaveBeenCalled();
  });

  it("lists entries with change/scenario counts and offers restore/delete", () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConsultationHistoryPanel
        entries={[entry({ id: "z", label: "Consultation 10:30" })]}
        canArchive
        onArchive={vi.fn()}
        onRestore={onRestore}
        onDelete={onDelete}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Consultation 10:30")).toBeInTheDocument();
    expect(screen.getByText(/3 changes · 2 scenarios/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Restore Consultation 10:30/i }));
    expect(onRestore).toHaveBeenCalledWith("z");

    fireEvent.click(screen.getByRole("button", { name: /Delete Consultation 10:30/i }));
    expect(onDelete).toHaveBeenCalledWith("z");
  });

  it("offers a clear-all action only when entries exist", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <ConsultationHistoryPanel
        entries={[]}
        canArchive
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClear={onClear}
      />,
    );
    expect(screen.queryByRole("button", { name: /Clear all/i })).not.toBeInTheDocument();

    rerender(
      <ConsultationHistoryPanel
        entries={[entry()]}
        canArchive
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Clear all/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
