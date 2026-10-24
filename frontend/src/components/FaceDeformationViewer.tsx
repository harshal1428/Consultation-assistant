import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ModelState } from "../scene/transformations/types";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import {
  createHeadGeometry,
  deformPositions,
  landmarkVertexIndices,
  resolveLandmarks,
  FEATURE_COLORS,
  HEAD_REGION_FRAME,
  HEAD_ASSET_EYE,
  computeSmoothNormals,
  type PersonalizedHeadModel,
} from "../scene/geometry";

interface FaceDeformationViewerProps {
  state: ModelState;
  showWireframe?: boolean;
  showLandmarks?: boolean;
  heatmapMode?: boolean;
  /** Personalized baseline. Neutral/undefined keeps the default head. */
  morph?: FaceMorph;
  /**
   * Reconstructed baseline from the multi-photo pipeline. When present it
   * *replaces* the generated surface: the reconstructed identity is applied as
   * a displacement field and the proportional morph is only used to place the
   * anatomical attachments.
   */
  personalized?: PersonalizedHeadModel | null;
  /** Skin tone sampled from the uploaded photo (personalization only). */
  skinTone?: string;
  /**
   * Photo-derived skin texture for the reconstructed mesh. When present, the
   * head is shaded with the patient's own projected skin detail and the
   * painted brows replace the torus brows.
   */
  skinTexture?: HTMLCanvasElement | null;
}

const SIDES = [-1, 1] as const;

/**
 * Non-deforming anatomy for the realistic head: eyeballs (sclera + iris +
 * pupil) and a subtle brow arc. The supplied mesh has its own eyelids and
 * no detachable ears, so those are omitted.
 */
function ModelFeatures({
  showBrows = true,
}: {
  showBrows?: boolean;
}) {
  const eyeRadius = HEAD_ASSET_EYE.radius;
  const eyeX = HEAD_ASSET_EYE.x;
  const eyeY = HEAD_ASSET_EYE.y;
  const eyeZ = HEAD_ASSET_EYE.z;
  const irisRadius = 0.035;
  const pupilRadius = 0.014;

  return (
    <group>
      {SIDES.map((side) => (
        <group key={side}>
          <group position={[side * eyeX, eyeY, eyeZ]} rotation={[0, side * 0.12, 0]}>
            <mesh>
              <sphereGeometry args={[eyeRadius, 32, 32]} />
              <meshStandardMaterial
                color={FEATURE_COLORS.sclera}
                roughness={0.24}
                metalness={0}
              />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.001]}>
              <sphereGeometry
                args={[eyeRadius * 1.002, 32, 12, 0, Math.PI * 2, 0, Math.acos(Math.min(0.999, irisRadius / (eyeRadius * 1.002)))]}
              />
              <meshStandardMaterial
                color={FEATURE_COLORS.iris}
                roughness={0.28}
                metalness={0}
              />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.002]}>
              <sphereGeometry
                args={[eyeRadius * 1.004, 32, 10, 0, Math.PI * 2, 0, Math.acos(Math.min(0.999, pupilRadius / (eyeRadius * 1.004)))]}
              />
              <meshStandardMaterial
                color={FEATURE_COLORS.pupil}
                roughness={0.18}
                metalness={0}
              />
            </mesh>
          </group>

          {showBrows && (
            <mesh
              position={[side * 0.2, 0.3, 0.965]}
              rotation={[-0.16, side * 0.26, Math.PI / 2 - (Math.PI * 0.62) / 2 - side * 0.14]}
            >
              <torusGeometry args={[0.13, 0.013, 10, 28, Math.PI * 0.62]} />
              <meshStandardMaterial
                color={FEATURE_COLORS.brow}
                roughness={0.74}
                metalness={0}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * Sculpted volumetric head viewer.
 *
 * The deformable shell is generated in `scene/geometry`; every parameter change
 * recomputes vertex positions from the immutable baseline through the single
 * documented scale pathway. Landmarks and the displacement heatmap are derived
 * from the real geometry difference. Eyes, brows and ears are separate,
 * non-deforming meshes so the head reads as a face.
 */
export function FaceDeformationViewer({
  state,
  showWireframe = false,
  showLandmarks = true,
  heatmapMode = false,
  morph,
  personalized,
  skinTone,
  skinTexture,
}: FaceDeformationViewerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const skinColor = skinTone ?? FEATURE_COLORS.skin;

  // Photo-derived skin texture. It is a plain CanvasTexture on fixed UVs, so
  // it follows every deformation without being regenerated.
  const projectedTexture = useMemo(() => {
    if (!skinTexture) return null;
    const texture = new THREE.CanvasTexture(skinTexture);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }, [skinTexture]);

  useEffect(() => {
    return () => {
      projectedTexture?.dispose();
    };
  }, [projectedTexture]);

  const hasSkinTexture = Boolean(projectedTexture && !heatmapMode);

  const baseline = useMemo(
    () => createHeadGeometry(undefined, undefined, morph, personalized, "model"),
    [morph, personalized],
  );
  const basePositions = useMemo(
    () => new Float32Array(baseline.getAttribute("position").array as ArrayLike<number>),
    [baseline],
  );
  const landmarkIndices = useMemo(
    () => landmarkVertexIndices(basePositions, morph, HEAD_REGION_FRAME),
    [basePositions, morph],
  );

  const model = useMemo(() => {
    const result = deformPositions(basePositions, state, HEAD_REGION_FRAME);
    const geometry = baseline.clone();
    geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
    const index = geometry.getIndex();
    if (index) {
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(computeSmoothNormals(result.positions, index.array), 3),
      );
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
    return {
      geometry,
      landmarks: resolveLandmarks(landmarkIndices, result.positions),
      maxDisplacement: result.maxDisplacement,
    };
  }, [baseline, basePositions, landmarkIndices, state]);

  useEffect(() => {
    return () => {
      model.geometry.dispose();
    };
  }, [model]);

  useFrame((frame) => {
    if (groupRef.current) {
      const t = frame.clock.getElapsedTime();
      groupRef.current.position.y = Math.sin(t * 0.8) * 0.008;
    }
  });

  const lm = model.landmarks;
  const sagittalLine = useMemo(() => {
    const order = [
      "nasion",
      "rhinion",
      "pronasale",
      "subnasale",
      "upper_lip",
      "lower_lip",
      "pogonion",
      "menton",
    ];
    const points = order
      .map((id) => lm[id])
      .filter((p): p is [number, number, number] => Boolean(p));
    return new Float32Array(points.flat());
  }, [lm]);

  return (
    <group ref={groupRef}>
      <mesh geometry={model.geometry}>
        <meshPhysicalMaterial
          color={heatmapMode ? "#ffffff" : hasSkinTexture ? "#ffffff" : skinColor}
          map={hasSkinTexture ? projectedTexture : null}
          vertexColors={heatmapMode}
          roughness={0.6}
          metalness={0.02}
          clearcoat={0.12}
          clearcoatRoughness={0.4}
          sheen={0.45}
          sheenRoughness={0.8}
          sheenColor="#f7c9b4"
          reflectivity={0.4}
          side={THREE.FrontSide}
          wireframe={showWireframe}
        />
      </mesh>

      <ModelFeatures showBrows={!hasSkinTexture} />

      {showWireframe && (
        <mesh geometry={model.geometry} scale={1.001}>
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.28} />
        </mesh>
      )}

      {showLandmarks && (
        <group>
          <mesh position={lm.rhinion}>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>

          <mesh position={lm.pronasale}>
            <sphereGeometry args={[0.026, 16, 16]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>

          <mesh position={lm.subnasale}>
            <sphereGeometry args={[0.018, 16, 16]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>

          <mesh position={lm.nasion}>
            <sphereGeometry args={[0.018, 16, 16]} />
            <meshBasicMaterial color="#6366f1" />
          </mesh>

          <mesh position={lm.alare_l}>
            <sphereGeometry args={[0.016, 16, 16]} />
            <meshBasicMaterial color="#a855f7" />
          </mesh>

          <mesh position={lm.alare_r}>
            <sphereGeometry args={[0.016, 16, 16]} />
            <meshBasicMaterial color="#a855f7" />
          </mesh>

          {lm.upper_lip && (
            <mesh position={lm.upper_lip}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#ec4899" />
            </mesh>
          )}

          {lm.lower_lip && (
            <mesh position={lm.lower_lip}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#ec4899" />
            </mesh>
          )}

          {lm.menton && (
            <mesh position={lm.menton}>
              <sphereGeometry args={[0.018, 16, 16]} />
              <meshBasicMaterial color="#14b8a6" />
            </mesh>
          )}

          {lm.cheek_l && (
            <mesh position={lm.cheek_l}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#f97316" />
            </mesh>
          )}

          {lm.cheek_r && (
            <mesh position={lm.cheek_r}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#f97316" />
            </mesh>
          )}

          {lm.jaw_l && (
            <mesh position={lm.jaw_l}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#eab308" />
            </mesh>
          )}

          {lm.jaw_r && (
            <mesh position={lm.jaw_r}>
              <sphereGeometry args={[0.016, 16, 16]} />
              <meshBasicMaterial color="#eab308" />
            </mesh>
          )}

          <line>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[sagittalLine, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#38bdf8" transparent opacity={0.4} />
          </line>
        </group>
      )}
    </group>
  );
}
