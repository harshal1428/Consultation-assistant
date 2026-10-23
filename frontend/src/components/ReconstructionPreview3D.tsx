import { useMemo, useState } from "react";
import {
  PREVIEW_CAMERAS,
  projectCanonicalMesh,
  projectTemplateSilhouette,
  type PreviewCameraId,
} from "../scene/geometry/reconstructionPreview";

interface ReconstructionPreview3DProps {
  /** The reconstructed canonical shape (3 floats per vertex). */
  shape: Float32Array | null;
  /** The canonical template the reconstruction is compared against. */
  template?: Float32Array | null;
  /** Triangle indices of the canonical model. */
  indices: Uint32Array | null;
  /** Height of the preview viewport in pixels. */
  height?: number;
}

/**
 * Interactive 3D preview of the reconstructed face.
 *
 * The mesh is projected and shaded in software (see
 * `scene/geometry/reconstructionPreview.ts`), so the preview always shows the
 * actual reconstructed geometry from the requested angle and can be verified
 * numerically. No photo is ever shown here - only the reconstructed mesh and
 * the neutral template silhouette it is compared against.
 */
export function ReconstructionPreview3D({
  shape,
  template,
  indices,
  height = 320,
}: ReconstructionPreview3DProps) {
  const [camera, setCamera] = useState<PreviewCameraId>("front");
  const [showTemplate, setShowTemplate] = useState(true);

  const projection = useMemo(() => {
    if (!shape || !indices) return null;
    return projectCanonicalMesh(shape, indices, camera);
  }, [shape, indices, camera]);

  const templatePoints = useMemo(() => {
    if (!shape || !template || !showTemplate) return null;
    return projectTemplateSilhouette(template, shape, camera);
  }, [shape, template, camera, showTemplate]);

  if (!shape || !indices) {
    return (
      <div className="preview3d preview3d--empty" style={{ height }}>
        <p>No reconstructed mesh to preview yet.</p>
      </div>
    );
  }

  const width = Math.round(height * 0.86);

  return (
    <div className="preview3d">
      <div className="preview3d__toolbar">
        <div className="preview3d__cameras" role="group" aria-label="Preview angle">
          {PREVIEW_CAMERAS.map((cam) => (
            <button
              key={cam.id}
              type="button"
              className={`btn btn--tiny ${camera === cam.id ? "btn--primary" : "btn--ghost"}`}
              aria-pressed={camera === cam.id}
              onClick={() => setCamera(cam.id)}
            >
              {cam.label}
            </button>
          ))}
        </div>
        <label className="preview3d__toggle">
          <input
            type="checkbox"
            checked={showTemplate}
            onChange={(e) => setShowTemplate(e.target.checked)}
          />
          Show neutral template
        </label>
      </div>

      <svg
        className="preview3d__canvas"
        viewBox="0 0 1 1"
        width={width}
        height={height}
        role="img"
        aria-label={`Reconstructed face, ${camera} view`}
      >
        <rect x={0} y={0} width={1} height={1} fill="var(--surface-2, #f8fafc)" />
        {templatePoints && templatePoints.length > 0 && (
          <polygon
            points={templatePoints.map((p) => `${p[0]},${p[1]}`).join(" ")}
            fill="none"
            stroke="var(--border-strong, #cbd5e1)"
            strokeWidth={0.004}
            strokeDasharray="0.012 0.008"
          />
        )}
        {projection?.triangles.map((tri, i) => (
          <polygon
            key={i}
            points={tri.points.map((p) => `${p[0]},${p[1]}`).join(" ")}
            fill={shadeColor(tri.shade)}
            stroke={shadeColor(tri.shade)}
            strokeWidth={0.0015}
          />
        ))}
        {projection?.markers.map((marker) => (
          <circle
            key={marker.label}
            cx={marker.x}
            cy={marker.y}
            r={0.012}
            fill="var(--accent, #0f766e)"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={0.003}
          />
        ))}
      </svg>

      <div className="preview3d__legend">
        {projection?.markers.map((marker) => (
          <span key={marker.label} className="preview3d__legend-item">
            <i className="preview3d__dot" />
            {marker.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Map a Lambert term to a neutral, readable skin tone. */
function shadeColor(shade: number): string {
  const t = Math.max(0, Math.min(1, shade));
  const r = Math.round(96 + t * 132);
  const g = Math.round(112 + t * 118);
  const b = Math.round(128 + t * 104);
  return `rgb(${r},${g},${b})`;
}
