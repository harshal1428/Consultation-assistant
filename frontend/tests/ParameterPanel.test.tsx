import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ParameterPanel } from "../src/components/ParameterPanel";
import { resetModel } from "../src/scene/transformations/logic";

const LABELS = [
  "Nasal bridge height",
  "Nasal bridge width",
  "Tip projection",
  "Tip height",
  "Tip rotation",
  "Alar width",
];

function renderPanel(
  state = resetModel(),
  onChange = vi.fn(),
  onReset = vi.fn(),
) {
  return render(
    <ParameterPanel modelState={state} onChange={onChange} onReset={onReset} />,
  );
}

function openRegion(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

describe("ParameterPanel", () => {
  it("lists the documented regions as selectable parts", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /^Nose/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Lips/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Chin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Jawline/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cheeks/ })).toBeInTheDocument();
  });

  it("keeps a region's parameters hidden until the part is clicked", () => {
    renderPanel();
    expect(screen.queryByLabelText("Alar width")).not.toBeInTheDocument();
    openRegion("Nose");
    for (const label of LABELS) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("marks the region as expanded when opened", () => {
    renderPanel();
    const nose = screen.getByRole("button", { name: /^Nose/ });
    expect(nose).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(nose);
    expect(screen.getByRole("button", { name: /^Nose/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows the current value with the correct unit", () => {
    renderPanel({ ...resetModel(), alarWidth: 5, tipRotation: -10 });
    openRegion("Nose");
    const alar = screen.getByLabelText("Alar width");
    expect(alar).toHaveValue("5");
    expect(screen.getByText("+5 mm")).toBeInTheDocument();
    const rotation = screen.getByLabelText("Tip rotation");
    expect(rotation).toHaveAttribute("max", "45");
    expect(screen.getByText("-10 °")).toBeInTheDocument();
  });

  it("badges regions that contain adjusted parameters", () => {
    renderPanel({ ...resetModel(), alarWidth: 4 });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("marks changed controls and enables their reset", () => {
    const onReset = vi.fn();
    renderPanel({ ...resetModel(), alarWidth: 4 }, vi.fn(), onReset);
    openRegion("Nose");
    expect(screen.getByText("changed")).toBeInTheDocument();
    const reset = screen.getByRole("button", { name: "Reset Alar width to 0" });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("keeps reset disabled for untouched controls", () => {
    renderPanel();
    openRegion("Nose");
    const reset = screen.getByRole("button", { name: "Reset Alar width to 0" });
    expect(reset).toBeDisabled();
  });

  it("reports manual changes with the parameter key and value", () => {
    const onChange = vi.fn();
    renderPanel(resetModel(), onChange);
    openRegion("Nose");
    fireEvent.change(screen.getByLabelText("Alar width"), {
      target: { value: "6" },
    });
    expect(onChange).toHaveBeenCalledWith("alarWidth", 6);
  });
});
