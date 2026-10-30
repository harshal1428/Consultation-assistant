import type { RefObject } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Center } from "@react-three/drei";
import { FaceDeformationViewer } from "./FaceDeformationViewer";
import type { ModelState } from "../scene/transformations/types";
import type { FaceMorph } from "../scene/geometry/faceMorph";
import type { PersonalizedHeadModel } from "../scene/geometry/personalizedHead";

interface FaceViewerProps {
  modelState: ModelState;
  showWireframe: boolean;
  showLandmarks: boolean;
  heatmapMode: boolean;
  controlsRef: RefObject<any>;
  morph?: FaceMorph;
  /** Reconstructed baseline from the multi-photo pipeline. */
  personalized?: PersonalizedHeadModel | null;
  skinTone?: string;
  /** Photo-derived skin texture for the reconstructed mesh. */
  skinTexture?: HTMLCanvasElement | null;
}

export function FaceViewer({
  modelState,
  showWireframe,
  showLandmarks,
  heatmapMode,
  controlsRef,
  morph,
  personalized,
  skinTone,
  skinTexture,
}: FaceViewerProps) {
  return (
    <div className="face-viewer">
      <Canvas
        camera={{ position: [1.7, 0.45, 2.9], fov: 42 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        dpr={[1, 2]}
      >
        {/* Key / fill / rim rig tuned for a believable skin read. */}
        <hemisphereLight args={["#fdf6f0", "#c8d4de", 0.85]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[4.5, 6, 5]} intensity={1.5} color="#fff4ea" />
        <directionalLight position={[-5, 1.5, 2]} intensity={0.45} color="#cfe4ee" />
        <directionalLight position={[-1.5, 3, -5]} intensity={0.6} color="#ffd9c4" />
        <pointLight position={[0, -1.2, 3]} intensity={0.35} color="#ffe8dd" />

        <Center>
          <FaceDeformationViewer
            state={modelState}
            showWireframe={showWireframe}
            showLandmarks={showLandmarks}
            heatmapMode={heatmapMode}
            morph={morph}
            personalized={personalized}
            skinTone={skinTone}
            skinTexture={skinTexture}
          />
        </Center>

        <OrbitControls
          ref={controlsRef}
          makeDefault
          minDistance={1.1}
          maxDistance={6}
          maxPolarAngle={Math.PI / 1.6}
        />
        <Grid
          position={[0, -1.05, 0]}
          args={[10, 10]}
          cellColor="#d6dee7"
          sectionColor="#9fb6c9"
          fadeDistance={14}
          fadeStrength={1.2}
        />
      </Canvas>

      {heatmapMode ? (
        <div
          className="face-viewer__heatmap-legend"
          role="img"
          aria-label="Displacement heatmap: blue is low movement, green is medium movement, red is high movement"
        >
          <span className="face-viewer__heatmap-title">Displacement</span>
          <span className="face-viewer__heatmap-bar" aria-hidden="true" />
          <span className="face-viewer__heatmap-scale" aria-hidden="true">
            <span>Low</span>
            <span>High</span>
          </span>
        </div>
      ) : null}

      <div className="face-viewer__legend" aria-hidden="true">
        Drag to rotate · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
}
