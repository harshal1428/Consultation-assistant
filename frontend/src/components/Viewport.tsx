
import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Center } from '@react-three/drei';
import { FaceDeformationViewer } from './FaceDeformationViewer';
import type { ModelState } from '../scene/transformations/types';

interface ViewportProps {
  modelState: ModelState;
}

export const Viewport: React.FC<ViewportProps> = ({ modelState }) => {
  const [showWireframe, setShowWireframe] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [heatmapMode, setHeatmapMode] = useState(false);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '520px', backgroundColor: '#090d16', borderRadius: '12px', overflow: 'hidden' }}>
      
      {/* 3D Viewport Toolbar Overlay */}
      <div style={{
        position: 'absolute',
        top: '14px',
        left: '14px',
        zIndex: 10,
        display: 'flex',
        gap: '8px',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '6px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <button
          type="button"
          onClick={() => setShowLandmarks(!showLandmarks)}
          style={{
            background: showLandmarks ? '#2563eb' : '#1e293b',
            color: '#f8fafc',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {showLandmarks ? '● Landmarks On' : '○ Landmarks Off'}
        </button>

        <button
          type="button"
          onClick={() => setShowWireframe(!showWireframe)}
          style={{
            background: showWireframe ? '#0284c7' : '#1e293b',
            color: '#f8fafc',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {showWireframe ? 'Mesh: Wireframe' : 'Mesh: Shaded'}
        </button>

        <button
          type="button"
          onClick={() => setHeatmapMode(!heatmapMode)}
          style={{
            background: heatmapMode ? '#dc2626' : '#1e293b',
            color: '#f8fafc',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {heatmapMode ? '🔥 Displacement Heatmap' : '👤 Skin Render'}
        </button>
      </div>

      {/* Orbit & View Legend */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '14px',
        zIndex: 10,
        fontSize: '11px',
        color: '#94a3b8',
        background: 'rgba(15, 23, 42, 0.6)',
        padding: '4px 8px',
        borderRadius: '6px',
        pointerEvents: 'none'
      }}>
        Left Click: Rotate • Right Click: Pan • Scroll: Zoom
      </div>

      <Canvas camera={{ position: [2.5, 0.8, 3.8], fov: 42 }}>
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 6, 4]} intensity={1.2} />
        <directionalLight position={[-4, 2, -2]} intensity={0.4} color="#38bdf8" />
        <directionalLight position={[0, -4, 3]} intensity={0.3} color="#f87171" />
        <Environment preset="city" />
        
        <Center>
          <FaceDeformationViewer 
            state={modelState} 
            showWireframe={showWireframe}
            showLandmarks={showLandmarks}
            heatmapMode={heatmapMode}
          />
        </Center>
        
        <OrbitControls 
          makeDefault 
          minDistance={1.8} 
          maxDistance={8} 
          maxPolarAngle={Math.PI / 1.6} 
        />
        <Grid 
          position={[0, -2.6, 0]}
          args={[12, 12]} 
          cellColor="#334155" 
          sectionColor="#0284c7" 
          fadeDistance={18} 
          fadeStrength={1.2} 
        />
      </Canvas>
    </div>
  );
};

