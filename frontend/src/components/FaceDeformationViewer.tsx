import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ModelState } from '../scene/transformations/types';

interface FaceDeformationViewerProps {
  state: ModelState;
  showWireframe?: boolean;
  showLandmarks?: boolean;
  heatmapMode?: boolean;
}

/**
 * Procedural Anatomical 3D Face Mesh with Real-Time Vertex Deformation
 * 
 * Generates an anatomical parametric face mask topology:
 * - Forehead, temples, eye orbits, bridge/dorsum, tip, nostrils (alar base), 
 *   philtrum, upper lip, chin, and jawline.
 * 
 * Performs true vertex-level deformation based on clinical simulation parameters:
 * - bridgeHeight (dorsal reduction / augmentation along normal and forward axis)
 * - bridgeWidth (alar/dorsal lateral narrowing or widening)
 * - tipHeight (vertical cephalic/caudal tip rotation and elevation)
 * - tipProjection (anterior-posterior tip displacement)
 * - tipRotation (nasolabial angle rotation around transverse axis)
 */
export const FaceDeformationViewer: React.FC<FaceDeformationViewerProps> = ({
  state,
  showWireframe = false,
  showLandmarks = true,
  heatmapMode = false,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireframeMeshRef = useRef<THREE.Mesh>(null);

  // Generate Base Anatomical Face Geometry once
  const baseGeometry = useMemo(() => {
    // We create a high-resolution parametric UV grid deformed into an anatomical human face contour
    const uSegments = 64; // Horizontal resolution
    const vSegments = 80; // Vertical resolution
    const geo = new THREE.PlaneGeometry(3.6, 4.8, uSegments, vSegments);

    const pos = geo.attributes.position;
    const count = pos.count;

    // Sculpt plane into natural human 3D face curvature
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);

      // Face base depth curvature (ellipsoidal cranial skull wrap)
      const faceCurvature = -Math.pow(x / 1.7, 2) * 1.2 - Math.pow((y - 0.2) / 2.5, 2) * 0.6;
      let z = faceCurvature;

      // 1. Forehead & Brow Ridge (y > 0.8)
      if (y > 0.7) {
        const browFactor = Math.exp(-Math.pow((y - 1.1) / 0.4, 2)) * Math.exp(-Math.pow(x / 1.2, 2));
        z += browFactor * 0.25;
      }

      // 2. Eye Orbits recession (-0.9 < x < 0.9, 0.4 < y < 1.0, |x| > 0.3)
      const eyeL = Math.exp(-Math.pow((x - 0.65) / 0.3, 2)) * Math.exp(-Math.pow((y - 0.7) / 0.25, 2));
      const eyeR = Math.exp(-Math.pow((x + 0.65) / 0.3, 2)) * Math.exp(-Math.pow((y - 0.7) / 0.25, 2));
      z -= (eyeL + eyeR) * 0.35;

      // 3. Cheekbones (Malar prominence: |x| ~ 1.0, y ~ 0.2)
      const cheekL = Math.exp(-Math.pow((x - 1.05) / 0.45, 2)) * Math.exp(-Math.pow((y - 0.2) / 0.4, 2));
      const cheekR = Math.exp(-Math.pow((x + 1.05) / 0.45, 2)) * Math.exp(-Math.pow((y - 0.2) / 0.4, 2));
      z += (cheekL + cheekR) * 0.28;

      // 4. Base Nose Anatomy (Dorsum / Bridge & Base Tip)
      // Nasal pyramid runs from y = 0.8 (radix/nasion) down to y = -0.5 (subnasale)
      if (y > -0.6 && y < 0.9) {
        // Lateral width of the nose at this height
        const widthProgress = (0.9 - y) / 1.5; // 0 at nasion, 1 at subnasale
        const noseW = 0.22 + widthProgress * 0.24;
        
        // Dorsal ridge profile
        const dorsalGaussian = Math.exp(-Math.pow(x / noseW, 2));
        const dorsalProfile = (0.8 - Math.abs(y - 0.2) * 0.6) * 0.95;
        
        if (dorsalProfile > 0) {
          z += dorsalGaussian * dorsalProfile;
        }

        // Distinct Nasal Tip Prominence at y = -0.25
        const tipDist = Math.sqrt(Math.pow(x, 2) + Math.pow(y - (-0.2), 2));
        const tipBulge = Math.exp(-Math.pow(tipDist / 0.32, 2)) * 0.42;
        z += tipBulge;

        // Alar Lobules / Nostril flares (|x| ~ 0.38, y ~ -0.32)
        const alarL = Math.exp(-Math.pow((x - 0.42) / 0.18, 2)) * Math.exp(-Math.pow((y - (-0.3)) / 0.2, 2));
        const alarR = Math.exp(-Math.pow((x + 0.42) / 0.18, 2)) * Math.exp(-Math.pow((y - (-0.3)) / 0.2, 2));
        z += (alarL + alarR) * 0.22;
      }

      // 5. Philtrum and Lips (y between -0.5 and -1.3)
      if (y < -0.4 && y > -1.4) {
        // Upper Lip prominence (y ~ -0.75)
        const upperLip = Math.exp(-Math.pow(x / 0.6, 2)) * Math.exp(-Math.pow((y - (-0.72)) / 0.16, 2)) * 0.28;
        // Lower Lip prominence (y ~ -1.0)
        const lowerLip = Math.exp(-Math.pow(x / 0.65, 2)) * Math.exp(-Math.pow((y - (-0.98)) / 0.18, 2)) * 0.32;
        // Mouth oral fissure depression (y ~ -0.85)
        const mouthDepression = Math.exp(-Math.pow(x / 0.7, 2)) * Math.exp(-Math.pow((y - (-0.85)) / 0.08, 2)) * 0.2;

        z += upperLip + lowerLip - mouthDepression;
      }

      // 6. Chin (Pogonion & Menton: y between -1.5 and -2.2)
      if (y < -1.3) {
        const chinBulge = Math.exp(-Math.pow(x / 0.55, 2)) * Math.exp(-Math.pow((y - (-1.65)) / 0.35, 2)) * 0.42;
        z += chinBulge;
      }

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();

    // Store base positions for subsequent deformation diff calculation
    const basePositions = new Float32Array(pos.array);
    return { geometry: geo, basePositions };
  }, []);

  // Cloned dynamic geometry that will be morphed by parameters
  const deformedGeometry = useMemo(() => {
    return baseGeometry.geometry.clone();
  }, [baseGeometry]);

  // Deformation logic: move selected vertices based on AI parameters
  useEffect(() => {
    const geo = deformedGeometry;
    const pos = geo.attributes.position;
    const base = baseGeometry.basePositions;
    const count = pos.count;

    // Convert clinical millimeters to 3D unit delta
    // 1 mm in real life corresponds to ~0.08 in 3D coordinate space
    const dBridgeHeight = state.bridgeHeight * 0.08;
    const dBridgeWidth = state.bridgeWidth * 0.08;
    const dTipHeight = state.tipHeight * 0.08;
    const dTipProjection = state.tipProjection * 0.08;
    const dTipRotationRad = (state.tipRotation * Math.PI) / 180;

    // Color attribute for Heatmap displacement visualization
    const colors = new Float32Array(count * 3);
    const colorA = new THREE.Color('#38bdf8'); // Blue (cool/neutral)
    const colorB = new THREE.Color('#22c55e'); // Green (mild shift)
    const colorC = new THREE.Color('#f43f5e'); // Red (maximum shift)

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const bx = base[idx];
      const by = base[idx + 1];
      const bz = base[idx + 2];

      let newX = bx;
      let newY = by;
      let newZ = bz;

      // ============================================================
      // A. NASAL BRIDGE / DORSUM VERTEX DEFORMATION
      // Affects vertices in the dorsal corridor: y between -0.1 and 0.85, |x| < 0.65
      // ============================================================
      if (by > -0.15 && by < 0.85 && Math.abs(bx) < 0.65) {
        // Gaussian weights centered along the dorsal midline (x = 0)
        const weightX = Math.exp(-Math.pow(bx / 0.28, 2));
        const weightY = Math.sin(((by - (-0.15)) / 1.0) * Math.PI); // Smooth bell along bridge length
        const dorsalWeight = weightX * weightY;

        // Bridge height: pushes/lowers along the anterior Z axis
        newZ += dBridgeHeight * dorsalWeight;

        // Bridge width: lateral expansion/compression along X axis
        if (Math.abs(bx) > 0.04) {
          const signX = Math.sign(bx);
          const widthInfluence = Math.exp(-Math.pow((Math.abs(bx) - 0.2) / 0.18, 2)) * weightY;
          newX += signX * dBridgeWidth * widthInfluence * 0.7;
        }
      }

      // ============================================================
      // B. NASAL TIP REGION VERTEX DEFORMATION
      // Affects vertices near the tip apex: centered at y = -0.22, z = high
      // ============================================================
      const distToTip = Math.sqrt(Math.pow(bx, 2) + Math.pow(by - (-0.22), 2) + Math.pow(bz - 0.8, 2));
      const tipFalloff = Math.exp(-Math.pow(distToTip / 0.48, 2));

      if (tipFalloff > 0.005) {
        // 1. Tip Projection (anterior translation in Z)
        newZ += dTipProjection * tipFalloff;

        // 2. Tip Height (vertical translation in Y)
        newY += dTipHeight * tipFalloff;

        // 3. Tip Rotation (Nasolabial angle rotation around transverse axis through subnasale)
        if (dTipRotationRad !== 0) {
          const pivotY = -0.5; // Subnasale pivot point
          const pivotZ = 0.3;
          const relY = newY - pivotY;
          const relZ = newZ - pivotZ;

          const cosR = Math.cos(dTipRotationRad * tipFalloff);
          const sinR = Math.sin(dTipRotationRad * tipFalloff);

          // Rotate (Y, Z)
          const rotatedY = relY * cosR - relZ * sinR;
          const rotatedZ = relY * sinR + relZ * cosR;

          newY = pivotY + rotatedY;
          newZ = pivotZ + rotatedZ;
        }
      }

      // ============================================================
      // C. ALAR WIDENING / NARROWING
      // ============================================================
      if (by > -0.48 && by < -0.1 && Math.abs(bx) > 0.22 && Math.abs(bx) < 0.65) {
        const alarWeight = Math.exp(-Math.pow((Math.abs(bx) - 0.42) / 0.16, 2)) * Math.exp(-Math.pow((by - (-0.3)) / 0.18, 2));
        newX += Math.sign(bx) * (dBridgeWidth * 0.5) * alarWeight;
      }

      // Apply deformed coordinates
      pos.setXYZ(i, newX, newY, newZ);

      // Compute displacement magnitude for heatmap vertex coloring
      const displacement = Math.sqrt(
        Math.pow(newX - bx, 2) + Math.pow(newY - by, 2) + Math.pow(newZ - bz, 2)
      );

      // Map displacement (0.0 to 0.4 max) to color gradient
      const factor = Math.min(displacement / 0.35, 1.0);
      let vColor = colorA.clone();
      if (factor < 0.5) {
        vColor.lerp(colorB, factor * 2);
      } else {
        vColor = colorB.clone().lerp(colorC, (factor - 0.5) * 2);
      }

      colors[idx] = vColor.r;
      colors[idx + 1] = vColor.g;
      colors[idx + 2] = vColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    if (meshRef.current) {
      meshRef.current.geometry.computeVertexNormals();
    }
  }, [state, deformedGeometry, baseGeometry]);

  // Subtle breathing idle animation for organic realism
  useFrame((stateThree) => {
    if (meshRef.current) {
      const t = stateThree.clock.getElapsedTime();
      meshRef.current.position.y = Math.sin(t * 0.8) * 0.015;
    }
  });

  return (
    <group position={[0, 0.1, 0]}>
      {/* Main Organic Medical Face Mesh */}
      <mesh ref={meshRef} geometry={deformedGeometry}>
        <meshPhysicalMaterial
          color={heatmapMode ? '#ffffff' : '#f0dcd0'}
          vertexColors={heatmapMode}
          roughness={0.42}
          metalness={0.05}
          clearcoat={0.3}
          clearcoatRoughness={0.25}
          reflectivity={0.5}
          side={THREE.DoubleSide}
          wireframe={showWireframe}
        />
      </mesh>

      {/* Wireframe Structural Overlay (if toggled) */}
      {showWireframe && (
        <mesh ref={wireframeMeshRef} geometry={deformedGeometry} position={[0, 0, 0.002]}>
          <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.35} />
        </mesh>
      )}

      {/* Anatomical Landmark Guides & Reference Vectors */}
      {showLandmarks && (
        <group>
          {/* Nasion / Rhinion / Tip Apex Markers */}
          {/* Rhinion (Nasal Bridge Center) */}
          <mesh position={[0, 0.25, 0.45 + state.bridgeHeight * 0.08]}>
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          
          {/* Tip Apex (Pronasale) */}
          <mesh position={[0, -0.2 + state.tipHeight * 0.08, 0.82 + state.tipProjection * 0.08]}>
            <sphereGeometry args={[0.045, 16, 16]} />
            <meshBasicMaterial color="#10b981" />
          </mesh>

          {/* Subnasale */}
          <mesh position={[0, -0.48, 0.4]}>
            <sphereGeometry args={[0.03, 16, 16]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>

          {/* Clinical Sagittal Guide Line */}
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[
                  new Float32Array([
                    0, 1.2, 0.1,
                    0, 0.25, 0.45 + state.bridgeHeight * 0.08,
                    0, -0.2 + state.tipHeight * 0.08, 0.82 + state.tipProjection * 0.08,
                    0, -0.48, 0.4,
                    0, -1.6, 0.3
                  ]),
                  3
                ]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#38bdf8" transparent opacity={0.4} />
          </line>
        </group>
      )}

      {/* Surgical Coordinate Reference Plane */}
      <mesh position={[0, 0, -0.8]} rotation={[0, 0, 0]}>
        <planeGeometry args={[4.2, 5.2]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};
