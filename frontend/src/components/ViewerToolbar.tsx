import type { ViewMode } from "../scene/transformations/types";
import { Icon } from "./Icon";

interface ViewerToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  showLandmarks: boolean;
  onToggleLandmarks: () => void;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  heatmapMode: boolean;
  onToggleHeatmap: () => void;
  onResetView: () => void;
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "before", label: "Original" },
  { value: "after", label: "Simulated" },
  { value: "compare", label: "Compare" },
];

export function ViewerToolbar({
  viewMode,
  onViewModeChange,
  showLandmarks,
  onToggleLandmarks,
  showWireframe,
  onToggleWireframe,
  heatmapMode,
  onToggleHeatmap,
  onResetView,
}: ViewerToolbarProps) {
  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="3D viewer controls">
      <div className="segmented" role="group" aria-label="View mode">
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`segmented__item ${viewMode === m.value ? "is-active" : ""}`}
            aria-pressed={viewMode === m.value}
            onClick={() => onViewModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="viewer-toolbar__spacer" />

      <button
        type="button"
        className={`tool-toggle ${showLandmarks ? "is-active" : ""}`}
        aria-pressed={showLandmarks}
        onClick={onToggleLandmarks}
      >
        <Icon name={showLandmarks ? "eye" : "eyeOff"} size={16} />
        Landmarks
      </button>

      <button
        type="button"
        className={`tool-toggle ${showWireframe ? "is-active" : ""}`}
        aria-pressed={showWireframe}
        onClick={onToggleWireframe}
      >
        <Icon name="grid" size={16} />
        Wireframe
      </button>

      <button
        type="button"
        className={`tool-toggle ${heatmapMode ? "is-active" : ""}`}
        aria-pressed={heatmapMode}
        onClick={onToggleHeatmap}
      >
        <Icon name="heat" size={16} />
        Displacement
      </button>

      <button
        type="button"
        className="tool-toggle"
        onClick={onResetView}
        aria-label="Reset camera view"
      >
        <Icon name="resetView" size={16} />
        Reset view
      </button>
    </div>
  );
}
