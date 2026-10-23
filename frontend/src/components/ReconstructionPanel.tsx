import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import {
  reconstructFaceFromMultiView,
  type ReconstructionResult,
  type ReconstructionPreview,
  createReconstructionPreview,
} from "../services/multiViewReconstruction";
import type { MultiViewPhotoController } from "../hooks/useMultiViewPhotos";
import { ReconstructionPreview3D } from "./ReconstructionPreview3D";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import type { PhotoView } from "../lib/multiViewPhoto";

interface ReconstructionPanelProps {
  /**
   * The shared photo controller. The panel never owns its own collection -
   * it must see exactly the photos the manager holds, otherwise the
   * reconstruction would silently be built from a different set.
   */
  photos: MultiViewPhotoController;
  /** Called when the reconstruction is accepted and should be applied to the simulation */
  onApplyReconstruction: (
    result: ReconstructionResult,
    preview: ReconstructionPreview,
  ) => void;
  /** Called when user wants to go back to photo management */
  onBackToPhotos: () => void;
  /** Called when user wants to cancel entirely */
  onCancel: () => void;
  /** Whether the panel is open */
  isOpen: boolean;
}

type Stage = "idle" | "reconstructing" | "preview" | "error";

export function ReconstructionPanel({
  photos,
  onApplyReconstruction,
  onBackToPhotos,
  onCancel,
  isOpen,
}: ReconstructionPanelProps) {
  const {
    validationResult,
    startReconstruction,
    setReconstructionProgress,
    finishReconstruction,
  } = photos;

  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<ReconstructionResult | null>(null);
  const [preview, setPreview] = useState<ReconstructionPreview | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  /**
   * The photo-collection version the current preview was built from. If the
   * photos change afterwards the preview is stale and must not be applied.
   */
  const [resultVersion, setResultVersion] = useState<number | null>(null);

  // Latest photo version, readable from an async continuation.
  const versionRef = useRef(photos.version);
  versionRef.current = photos.version;

  // Reset state when panel opens/closes
  useEffect(() => {
    if (isOpen) {
      setStage("idle");
      setResult(null);
      setPreview(null);
      setProgress(0);
      setProgressMessage("");
      setError("");
      setResultVersion(null);
    }
  }, [isOpen]);

  const usableViews = Array.from(photos.photos.values()).filter(
    (photo) => photo.landmarks && photo.landmarks.length > 0,
  );
  const canStart = usableViews.length >= 2;
  const isStale = resultVersion !== null && resultVersion !== photos.version;

  const handleStartReconstruction = useCallback(async () => {
    if (!canStart) return;

    const startedAtVersion = photos.version;
    setStage("reconstructing");
    setError("");
    setResult(null);
    setPreview(null);
    setResultVersion(null);
    startReconstruction();

    try {
      const reconstructionResult = await reconstructFaceFromMultiView(
        photos.photos,
        {},
        (p, msg) => {
          setProgress(p);
          setProgressMessage(msg);
          setReconstructionProgress(p);
        },
      );

      // The photos may have been replaced or removed while the fit was
      // running. Such a result describes photos that no longer exist.
      if (versionRef.current !== startedAtVersion) {
        const message =
          "The photos were changed while the reconstruction was running, so the result was discarded. Please run the reconstruction again.";
        setError(message);
        finishReconstruction(message);
        setStage("error");
        return;
      }

      setResult(reconstructionResult);
      finishReconstruction(reconstructionResult.error);

      if (reconstructionResult.success) {
        const previewData = createReconstructionPreview(photos.photos, reconstructionResult);
        setPreview(previewData);
        setResultVersion(startedAtVersion);
        setStage("preview");
      } else {
        setError(reconstructionResult.error);
        setStage("error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reconstruction failed.";
      setError(msg);
      finishReconstruction(msg);
      setStage("error");
    }
  }, [
    canStart,
    photos.photos,
    photos.version,
    startReconstruction,
    setReconstructionProgress,
    finishReconstruction,
  ]);

  const handleApply = useCallback(() => {
    if (result?.success && result.faceMorph && preview && !isStale) {
      onApplyReconstruction(result, preview);
    }
  }, [result, preview, isStale, onApplyReconstruction]);

  const handleRetry = useCallback(() => {
    setStage("idle");
    setError("");
    setResult(null);
    setPreview(null);
    setResultVersion(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--large reconstruction-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">
            <Icon name="activity" size={20} />
            3D Face Reconstruction
          </h2>
          <p className="modal__subtitle">
            {stage === "idle"
              ? "Ready to reconstruct a personalized 3D face from your photos."
              : stage === "reconstructing"
                ? "Fitting the shared 3D shape to all photographs..."
                : stage === "preview"
                  ? "Review the reconstruction and apply to simulation."
                  : "Reconstruction failed. Check the error and try again."}
          </p>
          <button className="btn btn--ghost btn--icon" onClick={onCancel} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="modal__body reconstruction-panel__body">
          {/* Stage: Idle - Ready to start */}
          {stage === "idle" && (
            <div className="reconstruction__idle">
              <div className="reconstruction__summary">
                <h3>Photo Set Summary</h3>
                <div className="summary-grid">
                  <div className="summary-item">
                    <span className="summary-label">Views with landmarks</span>
                    <span className="summary-value">
                      {usableViews.length} / {photos.photos.size}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Total landmarks</span>
                    <span className="summary-value">
                      {Array.from(photos.photos.values()).reduce(
                        (sum, p) => sum + (p.landmarks?.length || 0),
                        0,
                      )}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Required views</span>
                    <span className="summary-value">
                      {(["front", "left-profile", "right-profile"] as PhotoView[]).filter((v) => {
                        const p = photos.photos.get(v);
                        return p?.landmarks && p.landmarks.length > 0;
                      }).length} / 3
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Validation</span>
                    <span className={`summary-value ${validationResult?.ok ? "ok" : "warning"}`}>
                      {validationResult?.ok ? "Passed" : "Warnings"}
                    </span>
                  </div>
                </div>
              </div>

              {validationResult && validationResult.errors.length > 0 && (
                <div className="reconstruction__warnings reconstruction__warnings--error">
                  <h4>
                    <Icon name="alertCircle" size={16} /> Missing views
                  </h4>
                  <ul>
                    {validationResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  <p className="reconstruction__hint">
                    The reconstruction continues with the views that produced landmarks. It reports
                    the reduced accuracy in the quality metrics.
                  </p>
                </div>
              )}

              {validationResult && validationResult.warnings.length > 0 && (
                <div className="reconstruction__warnings">
                  <h4>
                    <Icon name="alertTriangle" size={16} /> Warnings
                  </h4>
                  <ul>
                    {validationResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="reconstruction__method">
                <h4>Reconstruction Method</h4>
                <p>
                  A genuine multi-view shape fit: the real MediaPipe Face Landmarker produces 3D
                  landmarks for every photograph and a shared 3D face shape is fitted to all of them
                  simultaneously, so the profile photographs supply the depth that a single frontal
                  photograph cannot reveal.
                </p>
                <ul className="method-details">
                  <li>
                    <strong>Model:</strong> MediaPipe canonical face model (468 vertices, 898
                    triangles, Apache-2.0) as the shape template and topology
                  </li>
                  <li>
                    <strong>Input:</strong> MediaPipe Face Landmarker 3D landmarks (478 points per
                    view)
                  </li>
                  <li>
                    <strong>Fitting:</strong> joint multi-view similarity poses with a
                    Laplacian-regularised shared shape and a canonical identity prior
                  </li>
                  <li>
                    <strong>Output:</strong> reconstructed 3D mesh, transferred onto the simulation
                    head as a per-vertex displacement field
                  </li>
                  <li>
                    <strong>Privacy:</strong> 100% local processing, no photo or landmark leaves the
                    device
                  </li>
                </ul>
              </div>

              <button
                className="btn btn--primary btn--large"
                onClick={handleStartReconstruction}
                disabled={!canStart}
              >
                <Icon name="arrowRight" size={18} />
                Start Reconstruction
              </button>
              {!canStart && (
                <p className="reconstruction__hint">
                  At least two photographs with a detected face are needed. Add or replace photos in
                  the photo manager.
                </p>
              )}
            </div>
          )}

          {/* Stage: Reconstructing */}
          {stage === "reconstructing" && (
            <div className="reconstruction__progress">
              <div className="progress-visual">
                <div className="progress-ring">
                  <svg viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="var(--border-strong)"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="4"
                      strokeDasharray={283}
                      strokeDashoffset={283 * (1 - progress / 100)}
                      strokeLinecap="round"
                      className="progress-ring__bar"
                    />
                  </svg>
                  <div className="progress-ring__text">{Math.round(progress)}%</div>
                </div>
                <p className="progress-message">{progressMessage}</p>
              </div>

              <div className="progress-steps">
                <ProgressStep label="Validating photos" completed={progress >= 15} />
                <ProgressStep
                  label="Fitting the shared 3D shape"
                  completed={progress >= 40}
                  active={progress >= 15 && progress < 70}
                />
                <ProgressStep
                  label="Transferring onto the head"
                  completed={progress >= 70}
                  active={progress >= 40 && progress < 85}
                />
                <ProgressStep
                  label="Computing quality metrics"
                  completed={progress >= 85}
                  active={progress >= 70 && progress < 95}
                />
                <ProgressStep label="Finalizing" completed={progress >= 100} active={progress >= 85 && progress < 100} />
              </div>
            </div>
          )}

          {/* Stage: Preview */}
          {stage === "preview" && result && preview && (
            <div className="reconstruction__preview">
              <div className="preview__views">
                <h3>Reconstructed Face</h3>
                <ReconstructionPreview3D
                  shape={preview.canonicalShape}
                  template={preview.canonicalModel?.positions ?? null}
                  indices={preview.canonicalIndices}
                />
                <p className="preview__hint">
                  Inspect the nose, eyes, mouth, jaw and the profile silhouette. The dashed outline is
                  the neutral template the reconstruction was fitted against.
                </p>
              </div>

              {isStale && (
                <div className="reconstruction__warnings reconstruction__warnings--stale">
                  <h4>
                    <Icon name="alertTriangle" size={16} /> Outdated
                  </h4>
                  <p>
                    The photos have changed since this reconstruction was produced. Run the
                    reconstruction again before applying it.
                  </p>
                </div>
              )}

              <div className="preview__quality">
                <h3>Reconstruction Quality</h3>
                <QualityScoreCard metrics={result.qualityMetrics} />
              </div>

              <div className="preview__morph">
                <h3>Personalized FaceMorph</h3>
                <FaceMorphDisplay morph={preview.faceMorph} />
              </div>

              <div className="preview__views">
                <h3>Views Used</h3>
                <div className="views-used">
                  {preview.viewsUsed.map((view) => (
                    <div key={view} className="view-used">
                      <Icon name="check" size={16} />
                      <span>{view}</span>
                      <span className="landmark-count">
                        {preview.landmarkCounts.get(view)} landmarks
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {preview.warnings.length > 0 && (
                <div className="preview__warnings">
                  <h4>
                    <Icon name="alertTriangle" size={16} /> Notes
                  </h4>
                  <ul>
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Stage: Error */}
          {stage === "error" && (
            <div className="reconstruction__error">
              <Icon name="alertCircle" size={64} className="error-icon" />
              <h3>Reconstruction Failed</h3>
              <p className="error-message">{error}</p>
              <div className="error-actions">
                <button className="btn btn--primary" onClick={handleRetry}>
                  <Icon name="resetView" size={16} /> Try Again
                </button>
                <button className="btn btn--ghost" onClick={onBackToPhotos}>
                  <Icon name="undo" size={16} /> Back to Photos
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal__footer">
          {stage === "preview" && (
            <>
              <button className="btn btn--ghost" onClick={onBackToPhotos}>
                <Icon name="undo" size={16} />
                Back to Photos
              </button>
              <button className="btn btn--primary" onClick={handleApply} disabled={isStale}>
                <Icon name="check" size={16} />
                Apply to Simulation
              </button>
            </>
          )}
          {stage === "idle" && (
            <>
              <button className="btn btn--ghost" onClick={onBackToPhotos}>
                <Icon name="undo" size={16} />
                Back to Photos
              </button>
              <button className="btn btn--ghost" onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
          {stage === "error" && (
            <>
              <button className="btn btn--ghost" onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
          {stage === "reconstructing" && (
            <button className="btn btn--ghost" onClick={onCancel} disabled>
              Please wait...
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function ProgressStep({
  label,
  completed,
  active,
}: {
  label: string;
  completed: boolean;
  active?: boolean;
}) {
  return (
    <div className={`progress-step ${completed ? "completed" : ""} ${active ? "active" : ""}`}>
      <div className="progress-step__icon">
        {completed ? <Icon name="check" size={16} /> : <Icon name="activity" size={16} />}
      </div>
      <span className="progress-step__label">{label}</span>
    </div>
  );
}

function QualityScoreCard({ metrics }: { metrics: ReconstructionResult["qualityMetrics"] }) {
  const score = Math.round(metrics.overallScore * 100);
  const getScoreClass = () => {
    if (score >= 80) return "excellent";
    if (score >= 60) return "good";
    if (score >= 40) return "fair";
    return "poor";
  };

  return (
    <div className={`quality-score ${getScoreClass()}`}>
      <div className="quality-score__main">
        <div className="quality-score__value">{score}%</div>
        <div className="quality-score__label">Overall Quality</div>
      </div>
      <div className="quality-score__breakdown">
        <QualityMetric
          label="Landmark Coverage"
          value={Math.round(metrics.landmarkCoverage * 100)}
          unit="%"
        />
        <QualityMetric label="View Coverage" value={Math.round(metrics.viewCoverage * 100)} unit="%" />
        <QualityMetric
          label="Fitting Accuracy"
          value={Math.round(Math.max(0, 1 - metrics.normalisedError / 0.1) * 100)}
          unit="%"
        />
        <QualityMetric label="Symmetry" value={Math.round(metrics.symmetryScore * 100)} unit="%" />
        <QualityMetric
          label="Depth Consistency"
          value={Math.round(metrics.depthConsistency * 100)}
          unit="%"
        />
        <QualityMetric
          label="Mean Reprojection"
          value={Math.round(metrics.fittingErrorPx * 10) / 10}
          unit=" px"
        />
        <QualityMetric
          label="Identity Deviation"
          value={Math.round(metrics.identityMagnitudeCm * 100) / 100}
          unit=" cm"
        />
      </div>
    </div>
  );
}

function QualityMetric({ label, value, unit }: { label: string; value: number; unit: string }) {
  const isGood =
    label === "Identity Deviation"
      ? value <= 1.5
      : label === "Mean Reprojection"
        ? value <= 5
        : value >= 60;
  return (
    <div className={`quality-metric ${isGood ? "good" : "warning"}`}>
      <div className="quality-metric__value">
        {value}
        {unit}
      </div>
      <div className="quality-metric__label">{label}</div>
    </div>
  );
}

function FaceMorphDisplay({ morph }: { morph: FaceMorph }) {
  const keys: (keyof FaceMorph)[] = [
    "faceWidth",
    "faceLength",
    "foreheadHeight",
    "jawWidth",
    "chinWidth",
    "chinLength",
    "cheekFullness",
    "eyeSpacing",
    "eyeSize",
    "eyeHeight",
    "browHeight",
    "noseWidth",
    "noseLength",
    "noseTip",
    "mouthWidth",
    "lipFullness",
  ];

  const labels: Record<keyof FaceMorph, string> = {
    faceWidth: "Face Width",
    faceLength: "Face Length",
    foreheadHeight: "Forehead Height",
    jawWidth: "Jaw Width",
    chinWidth: "Chin Width",
    chinLength: "Chin Length",
    cheekFullness: "Cheek Fullness",
    eyeSpacing: "Eye Spacing",
    eyeSize: "Eye Size",
    eyeHeight: "Eye Height",
    browHeight: "Brow Height",
    noseWidth: "Nose Width",
    noseLength: "Nose Length",
    noseTip: "Nose Tip Projection",
    mouthWidth: "Mouth Width",
    lipFullness: "Lip Fullness",
  };

  return (
    <div className="face-morph-display">
      <div className="face-morph__grid">
        {keys.map((key) => {
          const value = morph[key];
          const isNonZero = Math.abs(value) > 0.01;
          return (
            <div key={key} className={`face-morph__item ${isNonZero ? "modified" : ""}`}>
              <div className="face-morph__bar">
                <div
                  className="face-morph__fill"
                  style={{
                    width: `${Math.abs(value) * 100}%`,
                    background: value > 0 ? "var(--accent)" : "var(--danger)",
                  }}
                />
              </div>
              <div className="face-morph__info">
                <span className="face-morph__label">{labels[key]}</span>
                <span
                  className={`face-morph__value ${value > 0 ? "positive" : value < 0 ? "negative" : ""}`}
                >
                  {value > 0 ? "+" : ""}
                  {value.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
