import { useCallback, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import type { MultiViewPhotoController } from "../hooks/useMultiViewPhotos";
import {
  VIEW_LABELS,
  VIEW_DESCRIPTIONS,
  VIEW_ICONS,
  type PhotoView,
  type PatientPhoto,
} from "../lib/multiViewPhoto";
interface MultiViewPhotoManagerProps {
  /**
   * The shared photo controller owned by `App`. The manager never creates its
   * own collection, so the manager and the reconstruction panel always operate
   * on exactly the same photos.
   */
  photos: MultiViewPhotoController;
  /** Called when the user accepts the current photo set and wants to proceed to reconstruction */
  onAcceptPhotos: () => void;
  /** Called when the user wants to cancel/close the manager */
  onCancel: () => void;
  /** Whether the manager is open */
  isOpen: boolean;
}

export function MultiViewPhotoManager({
  photos: controller,
  onAcceptPhotos,
  onCancel,
  isOpen,
}: MultiViewPhotoManagerProps) {
  const {
    photos,
    status,
    error,
    validationResult,
    uploadPhoto,
    removePhoto,
    retryLandmarkDetection,
    clearAllPhotos,
    getPhoto,
    canReconstruct,
    uploadedCount,
    usableViewCount,
    missingRequiredViews,
    hasAllRequiredPhotos,
    requiredViews,
    optionalViews,
  } = controller;

  const [expandedView, setExpandedView] = useState<PhotoView | null>(null);
  const [showValidationDetails, setShowValidationDetails] = useState(false);

  /**
   * The hidden file inputs are registered here so the Upload / Replace buttons
   * can open the *correct* picker. Looking the input up from the DOM
   * relative to the button is fragile: the input is a sibling of the action
   * row, not a child of it.
   */
  const inputRefs = useRef(new Map<PhotoView, HTMLInputElement | null>());

  const registerInput = useCallback((view: PhotoView, element: HTMLInputElement | null) => {
    if (element) inputRefs.current.set(view, element);
    else inputRefs.current.delete(view);
  }, []);

  const openFilePicker = useCallback((view: PhotoView) => {
    inputRefs.current.get(view)?.click();
  }, []);

  const requiredComplete = useMemo(() => {
    return requiredViews.every((view) => {
      const photo = getPhoto(view);
      return photo?.file && photo.landmarks && photo.landmarks.length > 0;
    });
  }, [photos, getPhoto, requiredViews]);

  /** Required views that are still missing usable landmarks. */
  const missingRequired = useMemo(
    () => missingRequiredViews.map((view) => VIEW_LABELS[view]),
    [missingRequiredViews],
  );

  const totalLandmarks = useMemo(() => {
    let count = 0;
    for (const photo of photos.values()) {
      if (photo.landmarks) count += photo.landmarks.length;
    }
    return count;
  }, [photos]);

  const handleFileSelect = useCallback(
    async (view: PhotoView, event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await uploadPhoto(view, file);
      }
      event.target.value = "";
    },
    [uploadPhoto],
  );

  const handleRemove = useCallback(
    (view: PhotoView) => {
      removePhoto(view);
    },
    [removePhoto],
  );

  const handleRetry = useCallback(
    (view: PhotoView) => {
      retryLandmarkDetection(view);
    },
    [retryLandmarkDetection],
  );

  const handleClearAll = useCallback(() => {
    if (window.confirm("Remove all uploaded photos? This cannot be undone.")) {
      clearAllPhotos();
    }
  }, [clearAllPhotos]);

  const handleAccept = useCallback(() => {
    if (canReconstruct) {
      onAcceptPhotos();
    }
  }, [canReconstruct, onAcceptPhotos]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--large photo-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">
            <Icon name="image" size={20} />
            Patient Photos
          </h2>
          <p className="modal__subtitle">
            Upload front, left profile, and right profile photos for 3D face reconstruction.
            Additional views improve accuracy.
          </p>
          <button className="btn btn--ghost btn--icon" onClick={onCancel} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="modal__body photo-manager__body">
          {/* Summary bar */}
          <div className="photo-manager__summary">
            <div className="summary__item">
              <span className="summary__label">Uploaded</span>
              <span className="summary__value">
                {uploadedCount} / {requiredViews.length + optionalViews.length}
              </span>
            </div>
            <div className="summary__item">
              <span className="summary__label">Usable views</span>
              <span className="summary__value">{usableViewCount}</span>
            </div>
            <div className="summary__item">
              <span className="summary__label">Landmarks</span>
              <span className="summary__value">{totalLandmarks}</span>
            </div>
            <div className="summary__item">
              <span className="summary__label">Required</span>
              <span className={`summary__value ${requiredComplete ? "complete" : "incomplete"}`}>
                {requiredComplete ? "Complete" : "Incomplete"}
              </span>
            </div>
            <div className="summary__item">
              <span className="summary__label">Status</span>
              <span className={`summary__value status-${status}`}>{status}</span>
            </div>
          </div>

          {/* Validation warnings/errors */}
          {validationResult && (validationResult.errors.length > 0 || validationResult.warnings.length > 0) && (
            <div className="photo-manager__validation">
              <button
                className="validation__toggle"
                onClick={() => setShowValidationDetails(!showValidationDetails)}
              >
                <Icon
                  name="chevron"
                  size={16}
                  style={{ transform: showValidationDetails ? "rotate(180deg)" : "none" }}
                />
                <span>
                  {validationResult.errors.length} error(s), {validationResult.warnings.length} warning(s)
                </span>
              </button>
              {showValidationDetails && (
                <div className="validation__details">
                  {validationResult.errors.map((err, i) => (
                    <div key={i} className="validation__item validation__item--error">
                      <Icon name="alertCircle" size={14} />
                      <span>{err}</span>
                    </div>
                  ))}
                  {validationResult.warnings.map((warn, i) => (
                    <div key={i} className="validation__item validation__item--warning">
                      <Icon name="alertTriangle" size={14} />
                      <span>{warn}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="photo-manager__error" role="alert">
              <Icon name="alertCircle" size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Missing required views - always visible, not only in the details */}
          {missingRequired.length > 0 && (
            <div className="photo-manager__notice" role="status">
              <Icon name="alertTriangle" size={16} />
              <div>
                <strong>Missing usable views:</strong> {missingRequired.join(", ")}.
                {usableViewCount >= 2 ? (
                  <>
                    {" "}
                    The reconstruction will use the {usableViewCount} view
                    {usableViewCount === 1 ? "" : "s"} that were detected and will report the
                    reduced accuracy.
                  </>
                ) : (
                  <> At least two views with a detected face are needed.</>
                )}
              </div>
            </div>
          )}

          {/* Required views */}
          <div className="photo-manager__section">
            <h3 className="photo-manager__section-title">
              <Icon name="activity" size={16} />
              Required Views
              <span className="section-badge">
                {requiredViews.filter((v) => getPhoto(v)?.file).length} / {requiredViews.length}
              </span>
            </h3>
            <div className="photo-grid">
              {requiredViews.map((view) => (
                <PhotoViewCard
                  key={view}
                  view={view}
                  photo={getPhoto(view)!}
                  isRequired={true}
                  onUpload={handleFileSelect}
                  onRemove={handleRemove}
                  onRetry={handleRetry}
                  onExpand={() => setExpandedView(expandedView === view ? null : view)}
                  isExpanded={expandedView === view}
                  registerInput={registerInput}
                  openFilePicker={openFilePicker}
                />
              ))}
            </div>
          </div>

          {/* Optional views */}
          <div className="photo-manager__section">
            <h3 className="photo-manager__section-title">
              <Icon name="upload" size={16} />
              Optional Views
              <span className="section-badge">
                {optionalViews.filter((v) => getPhoto(v)?.file).length} / {optionalViews.length}
              </span>
            </h3>
            <div className="photo-grid">
              {optionalViews.map((view) => (
                <PhotoViewCard
                  key={view}
                  view={view}
                  photo={getPhoto(view)!}
                  isRequired={false}
                  onUpload={handleFileSelect}
                  onRemove={handleRemove}
                  onRetry={handleRetry}
                  onExpand={() => setExpandedView(expandedView === view ? null : view)}
                  isExpanded={expandedView === view}
                  registerInput={registerInput}
                  openFilePicker={openFilePicker}
                />
              ))}
            </div>
          </div>

          {/* Expanded detail view */}
          {expandedView && (
            <div className="photo-manager__detail">
              <PhotoViewDetail
                view={expandedView}
                photo={getPhoto(expandedView)!}
                onClose={() => setExpandedView(null)}
                onRetry={() => handleRetry(expandedView)}
                onRemove={() => {
                  handleRemove(expandedView);
                  setExpandedView(null);
                }}
                openFilePicker={openFilePicker}
              />
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          {uploadedCount > 0 && (
            <button className="btn btn--ghost btn--danger" onClick={handleClearAll} disabled={uploadedCount === 0}>
              <Icon name="trash" size={16} />
              Clear All
            </button>
          )}
          <button className="btn btn--primary" onClick={handleAccept} disabled={!canReconstruct}>
            <Icon name={canReconstruct ? "check" : "alertTriangle"} size={16} />
            {canReconstruct
              ? hasAllRequiredPhotos
                ? "Accept & Reconstruct"
                : "Accept & Reconstruct (reduced accuracy)"
              : "Need 2 Usable Views"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PhotoViewCard - Individual view upload card
// ============================================================================

interface PhotoViewCardProps {
  view: PhotoView;
  photo: PatientPhoto;
  isRequired: boolean;
  onUpload: (view: PhotoView, event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (view: PhotoView) => void;
  onRetry: (view: PhotoView) => void;
  onExpand: () => void;
  isExpanded: boolean;
  registerInput: (view: PhotoView, element: HTMLInputElement | null) => void;
  openFilePicker: (view: PhotoView) => void;
}

function PhotoViewCard({
  view,
  photo,
  isRequired,
  onUpload,
  onRemove,
  onRetry,
  onExpand,
  isExpanded,
  registerInput,
  openFilePicker,
}: PhotoViewCardProps) {
  const hasPhoto = !!photo.file;
  const hasLandmarks = !!photo.landmarks && photo.landmarks.length > 0;
  const validation = photo.validation;
  const landmarkStatus = photo.landmarkDetectionStatus;

  const getStatusClass = () => {
    if (!hasPhoto) return "empty";
    if (landmarkStatus === "running") return "processing";
    if (landmarkStatus === "error") return "error";
    if (hasLandmarks) return "ready";
    return "no-face";
  };

  const getStatusLabel = () => {
    if (!hasPhoto) return "No photo";
    if (landmarkStatus === "running") return "Detecting face...";
    if (hasLandmarks) return `${photo.landmarks!.length} landmarks`;
    // Either the detector did not fire or the detection failed. The short
    // label stays short; the reason is shown below the status.
    return "No face detected";
  };

  return (
    <div
      className={`photo-card ${getStatusClass()} ${isExpanded ? "expanded" : ""}`}
      data-view={view}
      data-landmark-status={landmarkStatus}
      onClick={onExpand}
    >
      <input
        ref={(element) => {
          registerInput(view, element);
        }}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="photo-card__input"
        data-view={view}
        onChange={(e) => onUpload(view, e)}
        disabled={landmarkStatus === "running"}
        aria-label={`Upload ${VIEW_LABELS[view]}`}
      />

      <div className="photo-card__content">
        <div className="photo-card__icon">
          <Icon name={VIEW_ICONS[view] as IconName} size={32} />
        </div>

        {hasPhoto && photo.previewUrl && (
          <div className="photo-card__preview">
            <img src={photo.previewUrl} alt={VIEW_LABELS[view]} />
            {landmarkStatus === "running" && (
              <div className="photo-card__overlay">
                <div className="spinner" />
                <span>Detecting landmarks...</span>
              </div>
            )}
          </div>
        )}

        <div className="photo-card__info">
          <div className="photo-card__header">
            <h4 className="photo-card__title">{VIEW_LABELS[view]}</h4>
            {isRequired && <span className="badge badge--required">Required</span>}
          </div>
          <p className="photo-card__description">{VIEW_DESCRIPTIONS[view]}</p>

          <div className={`photo-card__status status--${getStatusClass()}`}>
            <span className="status-indicator" />
            <span>{getStatusLabel()}</span>
          </div>

          {validation.warnings.length > 0 && (
            <div className="photo-card__warnings">
              {validation.warnings.map((w, i) => (
                <div key={i} className="warning">
                  <Icon name="alertTriangle" size={12} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {photo.landmarkError && (
            <div className="photo-card__warnings">
              <div className="warning warning--error">
                <Icon name="alertCircle" size={12} />
                <span>{photo.landmarkError}</span>
              </div>
            </div>
          )}
        </div>

        <div className="photo-card__actions">
          {!hasPhoto ? (
            <button
              className="btn btn--primary btn--sm"
              onClick={(e) => {
                e.stopPropagation();
                openFilePicker(view);
              }}
            >
              <Icon name="upload" size={14} />
              Upload
            </button>
          ) : (
            <>
              <button
                className="btn btn--ghost btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openFilePicker(view);
                }}
              >
                <Icon name="upload" size={14} />
                Replace
              </button>
              {landmarkStatus === "error" && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(view);
                  }}
                >
                  <Icon name="resetView" size={14} />
                  Retry
                </button>
              )}
              <button
                className="btn btn--ghost btn--sm btn--danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(view);
                }}
              >
                <Icon name="trash" size={14} />
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="photo-card__expand-indicator">
          <Icon name="chevron" size={16} style={{ transform: "rotate(180deg)" }} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PhotoViewDetail - Expanded view with landmark visualization
// ============================================================================

interface PhotoViewDetailProps {
  view: PhotoView;
  photo: PatientPhoto;
  onClose: () => void;
  onRetry: () => void;
  onRemove: () => void;
  openFilePicker: (view: PhotoView) => void;
}

function PhotoViewDetail({
  view,
  photo,
  onClose,
  onRetry,
  onRemove,
  openFilePicker,
}: PhotoViewDetailProps) {
  const hasPhoto = !!photo.file;
  const hasLandmarks = !!photo.landmarks && photo.landmarks.length > 0;
  const validation = photo.validation;

  if (!hasPhoto) return null;

  return (
    <div className="photo-detail">
      <div className="photo-detail__header">
        <h3>
          <Icon name={VIEW_ICONS[view] as IconName} size={20} />
          {VIEW_LABELS[view]}
        </h3>
        <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close detail">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="photo-detail__content">
        <div className="photo-detail__image">
          <img src={photo.previewUrl} alt={VIEW_LABELS[view]} />
          {hasLandmarks && photo.landmarks && <LandmarkOverlay landmarks={photo.landmarks} />}
        </div>

        <div className="photo-detail__info">
          <div className="info-group">
            <h4>Validation</h4>
            <div className={`info-status ${validation.ok ? "ok" : "error"}`}>
              <span className="status-dot" />
              {validation.ok ? "Valid" : validation.error}
            </div>
            {validation.imageDimensions && (
              <div className="info-row">
                <span>Dimensions</span>
                <span>
                  {validation.imageDimensions.width} × {validation.imageDimensions.height} px
                </span>
              </div>
            )}
            {validation.warnings.length > 0 && (
              <div className="info-warnings">
                {validation.warnings.map((w, i) => (
                  <div key={i} className="warning">
                    <Icon name="alertTriangle" size={12} />
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="info-group">
            <h4>Landmark Detection</h4>
            <div
              className={`info-status ${photo.landmarkDetectionStatus === "complete" ? "ok" : photo.landmarkDetectionStatus === "error" ? "error" : "pending"}`}
            >
              <span className="status-dot" />
              {photo.landmarkDetectionStatus === "complete"
                ? `${photo.landmarks?.length || 0} landmarks detected`
                : photo.landmarkDetectionStatus === "error"
                  ? `Error: ${photo.landmarkError}`
                  : "Pending..."}
            </div>
            {photo.landmarkDetectionStatus === "error" && (
              <button className="btn btn--ghost btn--sm" onClick={onRetry}>
                <Icon name="resetView" size={14} /> Retry Detection
              </button>
            )}
          </div>

          <div className="info-group">
            <h4>Actions</h4>
            <div className="detail-actions">
              <button
                className="btn btn--ghost btn--sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openFilePicker(view);
                }}
              >
                <Icon name="upload" size={14} /> Replace Photo
              </button>
              <button className="btn btn--ghost btn--sm btn--danger" onClick={onRemove}>
                <Icon name="trash" size={14} /> Remove Photo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LandmarkOverlay - Visualize detected landmarks on the photo
// ============================================================================

interface LandmarkOverlayProps {
  landmarks: { x: number; y: number; z: number }[];
}

function LandmarkOverlay({ landmarks }: LandmarkOverlayProps) {
  // Only show a subset of landmarks for clarity (every 4th point)
  const displayLandmarks = landmarks.filter((_, i) => i % 4 === 0);

  return (
    <svg className="landmark-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
      {displayLandmarks.map((lm, i) => (
        <circle
          key={i}
          cx={lm.x}
          cy={lm.y}
          r={0.005}
          fill="#00ff88"
          stroke="#003322"
          strokeWidth={0.002}
        />
      ))}
    </svg>
  );
}
