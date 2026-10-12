import { useRef } from 'react';
import type { ModelState } from '../scene/transformations/types';
import * as THREE from 'three';

interface NoseModelProps {
  state: ModelState;
}

export const NoseModel: React.FC<NoseModelProps> = ({ state }) => {
  const group = useRef<THREE.Group>(null);
  
  // Base scales and positions
  const baseBridgeHeight = 2.2;
  const baseBridgeWidth = 0.6;
  const baseTipProjection = 1.4;
  
  // Calculate transformed values
  const bridgeWidth = baseBridgeWidth + state.bridgeWidth * 0.1;
  const bridgeHeight = baseBridgeHeight + state.bridgeHeight * 0.1;
  const tipProj = baseTipProjection + state.tipProjection * 0.1;
  const tipRot = (state.tipRotation * Math.PI) / 180; 
  const tipH = -1.2 + state.tipHeight * 0.1;

  // Premium surgical material
  const surgicalSkinMaterial = new THREE.MeshPhysicalMaterial({
    color: '#e5d0c3',
    roughness: 0.35,
    metalness: 0.1,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    flatShading: true, // Gives a CAD/Clinical geometry look
  });

  const blueGridMaterial = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    wireframe: true,
    transparent: true,
    opacity: 0.15
  });

  return (
    <group ref={group} position={[0, 0.5, 0]}>
      
      {/* Surgical Grid Overlay / Bounding Box aesthetic */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[4, 5, 4]} />
        <primitive object={blueGridMaterial} attach="material" />
      </mesh>

      <group position={[0, 0.5, 0]}>
        {/* Face Base / Forehead to lip profile */}
        <mesh position={[0, 1.5, -0.5]}>
          <boxGeometry args={[2, 1, 1]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>
        
        <mesh position={[0, -2.2, -0.5]}>
          <boxGeometry args={[1.8, 1.5, 1]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>

        {/* Nasal Bridge / Dorsum */}
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 7, 0, 0]}>
          <cylinderGeometry args={[bridgeWidth * 0.5, bridgeWidth * 0.9, bridgeHeight, 8]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>
        
        {/* Nasal Tip */}
        <mesh position={[0, tipH, tipProj]} rotation={[-tipRot, 0, 0]}>
          <sphereGeometry args={[0.5 + bridgeWidth*0.2, 16, 16]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>
        
        {/* Alar Base / Nostrils */}
        <mesh position={[-0.45, tipH - 0.1, tipProj - 0.3]} rotation={[0.4, 0.2, 0]}>
          <sphereGeometry args={[0.3, 12, 12]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>
        
        <mesh position={[0.45, tipH - 0.1, tipProj - 0.3]} rotation={[0.4, -0.2, 0]}>
          <sphereGeometry args={[0.3, 12, 12]} />
          <primitive object={surgicalSkinMaterial} attach="material" />
        </mesh>
      </group>

    </group>
  );
}
