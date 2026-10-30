import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NewConsultationDialog } from "../src/components/NewConsultationDialog";

function renderDialog(overrides: Partial<Parameters<typeof NewConsultationDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <NewConsultationDialog
      open
      initialSurgeon=""
      hasCurrentWork={false}
      currentCanBeArchived={false}
      currentPatientName=""
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm, dialog: screen.getByRole("dialog") };
}

describe("NewConsultationDialog", () => {
  it("requires a patient name and surgeon", () => {
    const { dialog, onConfirm } = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /Start new consultation/i }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the patient name.");
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Patient name/i), {
      target: { value: "Asha Rao" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Start new consultation/i }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the surgeon name.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("starts a new consultation with a trimmed identity and keeps the surgeon", () => {
    const { dialog, onConfirm } = renderDialog({ initialSurgeon: " Dr. Mehta " });

    expect(within(dialog).getByLabelText(/Surgeon/i)).toHaveValue(" Dr. Mehta ");

    fireEvent.change(within(dialog).getByLabelText(/Patient name/i), {
      target: { value: "  Asha Rao  " },
    });
    fireEvent.change(within(dialog).getByLabelText(/Patient ID/i), {
      target: { value: " MRN-1001 " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Start new consultation/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      patientId: "MRN-1001",
      patientName: "Asha Rao",
      surgeonName: "Dr. Mehta",
    });
  });

  it("explains when the current consultation cannot be archived", () => {
    const { dialog } = renderDialog({
      hasCurrentWork: true,
      currentCanBeArchived: false,
      currentPatientName: "Asha Rao",
    });

    expect(
      within(dialog).getByText(/will not be archived/i),
    ).toBeInTheDocument();
  });
});
