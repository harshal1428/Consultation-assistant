import { useRef, useState } from "react";
import { FaceViewer } from "./FaceViewer";
import { ViewerToolbar } from "./ViewerToolbar";
import { Icon } from "./Icon";
import type { ModelState, ViewMode } from "../scene/transformations/types";
import { initialModelState, SIMULATED_PARAM_KEYS } from "../scene/transformations/types";
import type { Scenario } from "../scene/session/types";
import { PARAM_DESCRIPTORS } from "../lib/params";
import type { ActivePersonalization } from "../hooks/useFacePersonalization";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import type { PersonalizedHeadModel } from "../scene/geometry/personalizedHead";

interface SimulationWorkspaceProps {
  modelState: ModelState;
  scenarios: Scenario[];
  personalization: ActivePersonalization | null;
  onOpenPhotoManager: () => void;
  reconstructedMorph?: FaceMorph | null;
  /** Reconstructed baseline produced by the multi-photo pipeline. */
  personalizedModel?: PersonalizedHeadModel | null;
  /** True when the applied reconstruction no longer matches the photo set. */
  reconstructionOutdated?: boolean;
  /** Photo-derived skin texture for the reconstructed mesh (null until ready). */
  skinTexture?: HTMLCanvasElement | null;
}

const BASELINE = "baseline";
const CURRENT = "current";

function scenarioSourceId(id: string): string {
  return `scenario:${id}`;
}

export function SimulationWorkspace({
  modelState,
  scenarios,
  personalization,
  onOpenPhotoManager,
  reconstructedMorph,
  personalizedModel,
  reconstructionOutdated = false,
  skinTexture,
}: SimulationWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("after");
  // Landmarks are an opt-in measurement overlay. They default off so the
  // default view shows the bare face (the coloured landmark markers otherwise
  // sit as spheres on the nose and read as geometry bulges).
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [heatmapMode, setHeatmapMode] = useState(false);

  const [leftId, setLeftId] = useState<string>(BASELINE);
  const [rightId, setRightId] = useState<string>(CURRENT);

  // The reconstructed identity always wins over the legacy single-photo fit:
  // it carries the real multi-view geometry, while the morph is only used to
  // place the anatomical attachments on the personalized surface.
  const morph = personalizedModel?.morph ?? reconstructedMorph ?? personalization?.morph;
  const skinTone = personalization?.skinTone;

  const singleControls = useRef<any>(null);
  const originalControls = useRef<any>(null);
  const simulatedControls = useRef<any>(null);

  const resolveState = (id: string): ModelState => {
    if (id === BASELINE) return initialModelState;
    if (id === CURRENT) return modelState;
    const scenario = scenarios.find((s) => scenarioSourceId(s.id) === id);
    return scenario ? scenario.state : modelState;
  };

  const sources = [
    { id: BASELINE, label: "Original (baseline)" },
    { id: CURRENT, label: "Current working" },
    ...scenarios.map((s) => ({ id: scenarioSourceId(s.id), label: s.name })),
  ];

  const leftState = resolveState(leftId);
  const rightState = resolveState(rightId);
  const diffRows = SIMULATED_PARAM_KEYS.map((key) => ({
    key,
    label: PARAM_DESCRIPTORS[key].shortLabel,
    unit: PARAM_DESCRIPTORS[key].unit === "degrees" ? "°" : "mm",
    left: leftState[key],
    right: rightState[key],
  })).filter((row) => row.left !== row.right);

  const handleResetView = () => {
    singleControls.current?.reset?.();
    originalControls.current?.reset?.();
    simulatedControls.current?.reset?.();
  };

  return (
    <section className="panel workspace" aria-label="3D simulation workspace">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="activity" size={16} />
            3D Simulation
          </h2>
          <p className="panel__subtitle">
            {viewMode === "compare"
              ? "Compare any two states side by side"
              : viewMode === "before"
                ? "Original (unmodified) appearance"
                : "Current simulated appearance"}
          </p>
        </div>
        <div className="panel__header-actions">
          <span className="chip chip--muted">
            {personalizedModel ? "Reconstructed patient mesh" : "Procedural prototype mesh"}
          </span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onOpenPhotoManager}
            aria-label="View or change patient photos"
          >
            <Icon name="image" size={14} />
            View / Change Photos
          </button>
        </div>
      </div>

      {reconstructionOutdated && (
        <div className="workspace__stale" role="status">
          <Icon name="alertTriangle" size={14} />
          <span>
            The patient photos changed after the last reconstruction. Open “View / Change Photos”
            and reconstruct again to refresh the model.
          </span>
        </div>
      )}

      <ViewerToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showLandmarks={showLandmarks}
        onToggleLandmarks={() => setShowLandmarks((v) => !v)}
        showWireframe={showWireframe}
        onToggleWireframe={() => setShowWireframe((v) => !v)}
        heatmapMode={heatmapMode}
        onToggleHeatmap={() => setHeatmapMode((v) => !v)}
        onResetView={handleResetView}
      />

      {viewMode === "compare" ? (
        <div className="compare-selectors">
          <label className="compare-selectors__field">
            <span>Left</span>
            <select
              className="select select--sm"
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="compare-selectors__vs" aria-hidden="true">
            vs
          </span>
          <label className="compare-selectors__field">
            <span>Right</span>
            <select
              className="select select--sm"
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="workspace__stage">
        <div className={`viewport ${viewMode === "compare" ? "viewport--split" : ""}`}>
        {viewMode === "compare" ? (
          <>
            <div className="viewport__pane">
              <span className="viewport__pane-tag viewport__pane-tag--neutral">
                {sources.find((s) => s.id === leftId)?.label ?? "Left"}
              </span>
              <FaceViewer
                modelState={leftState}
                showWireframe={showWireframe}
                showLandmarks={showLandmarks}
                heatmapMode={heatmapMode}
                controlsRef={originalControls}
                morph={morph}
                personalized={personalizedModel}
                skinTone={skinTone}
                skinTexture={skinTexture}
              />
            </div>
            <div className="viewport__pane">
              <span className="viewport__pane-tag viewport__pane-tag--accent">
                {sources.find((s) => s.id === rightId)?.label ?? "Right"}
              </span>
              <FaceViewer
                modelState={rightState}
                showWireframe={showWireframe}
                showLandmarks={showLandmarks}
                heatmapMode={heatmapMode}
                controlsRef={simulatedControls}
                morph={morph}
                personalized={personalizedModel}
                skinTone={skinTone}
                skinTexture={skinTexture}
              />
            </div>
          </>
        ) : (
          <FaceViewer
            modelState={viewMode === "before" ? initialModelState : modelState}
            showWireframe={showWireframe}
            showLandmarks={showLandmarks}
            heatmapMode={heatmapMode}
            controlsRef={singleControls}
            morph={morph}
            personalized={personalizedModel}
            skinTone={skinTone}
            skinTexture={skinTexture}
          />
        )}
        </div>

        {/* 
          Multi-view photo management is now accessed via the "View / Change Photos" 
          button in the header. The old single-photo PhotoPanel has been replaced 
          by the MultiViewPhotoManager modal which keeps photos hidden from the 
          main workspace until explicitly opened.
        */}
      </div>

      {viewMode === "compare" ? (
        <div className="compare-diff">
          <h3 className="compare-diff__title">
            <Icon name="sliders" size={14} /> Parameter differences
          </h3>
          {diffRows.length === 0 ? (
            <p className="compare-diff__empty">
              These two states are identical across all simulated parameters.
            </p>
          ) : (
            <table className="compare-diff__table">
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">
                    {sources.find((s) => s.id === leftId)?.label ?? "Left"}
                  </th>
                  <th scope="col">
                    {sources.find((s) => s.id === rightId)?.label ?? "Right"}
                  </th>
                  <th scope="col">Δ</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((row) => {
                  const delta = row.right - row.left;
                  return (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {row.left > 0 ? "+" : ""}
                        {row.left}
                        {row.unit}
                      </td>
                      <td>
                        {row.right > 0 ? "+" : ""}
                        {row.right}
                        {row.unit}
                      </td>
                      <td className={delta === 0 ? "" : delta > 0 ? "is-pos" : "is-neg"}>
                        {delta > 0 ? "+" : ""}
                        {delta}
                        {row.unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <p className="workspace__note">
        The mesh is a generated prototype head, not a patient scan. With patient photos loaded
        it carries a multi-photo reconstruction: the MediaPipe canonical face model is fitted to
        the landmarks of every photograph at once and the resulting identity is transferred onto
        the head as a displacement field, so the profile views contribute real depth. It is still
        not a 3D scan and not photorealistic. Lengths use an illustrative reference scale with no
        verified physical dimensions, so values are not calibrated for clinical use.
      </p>
    </section>
  );
}
