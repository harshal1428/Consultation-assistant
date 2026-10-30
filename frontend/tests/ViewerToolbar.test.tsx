import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ViewerToolbar } from "../src/components/ViewerToolbar";

function renderToolbar(overrides: Partial<Parameters<typeof ViewerToolbar>[0]> = {}) {
  const props = {
    viewMode: "after" as const,
    onViewModeChange: vi.fn(),
    showLandmarks: false,
    onToggleLandmarks: vi.fn(),
    showWireframe: false,
    onToggleWireframe: vi.fn(),
    heatmapMode: false,
    onToggleHeatmap: vi.fn(),
    onResetView: vi.fn(),
    ...overrides,
  };
  render(<ViewerToolbar {...props} />);
  return props;
}

describe("ViewerToolbar", () => {
  it("keeps the displacement heatmap control visible", () => {
    renderToolbar();

    const heatmap = screen.getByRole("button", { name: /heatmap/i });
    expect(heatmap).toBeInTheDocument();
    expect(heatmap).toHaveAttribute("aria-pressed", "false");
  });

  it("reflects the active heatmap state and toggles it", () => {
    const props = renderToolbar({ heatmapMode: true });

    const heatmap = screen.getByRole("button", { name: /heatmap/i });
    expect(heatmap).toHaveAttribute("aria-pressed", "true");
    expect(heatmap.className).toContain("is-active");

    fireEvent.click(heatmap);
    expect(props.onToggleHeatmap).toHaveBeenCalledTimes(1);
  });
});
