import { useRef } from 'react';
import type { ModelState } from '../scene/transformations/types';
import * as THREE from 'three';

interface NoseModelProps {
  state: ModelState;
}

export const NoseModel: React.FC<NoseModelProps> = ({ state }) => {
  const group = useRef<THREE.Group>(null);
  
  // Base scales and positions
  const baseBridgeHeight = 2;
  const baseBridgeWidth = 0.6;
  const baseTipProjection = 1.2;
  
  // Calculate transformed values
  const bridgeWidth = baseBridgeWidth + state.bridgeWidth * 0.1;
  const bridgeHeight = baseBridgeHeight + state.bridgeHeight * 0.1;
  const tipProj = baseTipProjection + state.tipProjection * 0.1;
  const tipRot = (state.tipRotation * Math.PI) / 180; // Assuming value in degrees visually
  const tipH = -1.2 + state.tipHeight * 0.1;

  return (
    <group ref={group} position={[0, 0, 0]}>
      {/* Nasal Bridge / Dorsum */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 6, 0, 0]}>
        <cylinderGeometry args={[bridgeWidth * 0.6, bridgeWidth, bridgeHeight, 32]} />
        <meshStandardMaterial color="#fcd8c7" />
      </mesh>
      
      {/* Nasal Tip */}
      <mesh position={[0, tipH, tipProj]} rotation={[-tipRot, 0, 0]}>
        <sphereGeometry args={[0.5 + bridgeWidth*0.2, 32, 32]} />
        <meshStandardMaterial color="#fcd8c7" />
      </mesh>
      
      {/* Nostrils */}
      <mesh position={[-0.35, tipH - 0.2, tipProj - 0.2]} rotation={[0.4, 0.2, 0]}>
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshStandardMaterial color="#ebbea8" />
      </mesh>
      
      <mesh position={[0.35, tipH - 0.2, tipProj - 0.2]} rotation={[0.4, -0.2, 0]}>
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshStandardMaterial color="#ebbea8" />
      </mesh>
    </group>
  );
}
