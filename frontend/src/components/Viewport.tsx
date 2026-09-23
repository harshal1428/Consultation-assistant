
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import { NoseModel } from './NoseModel';
import type { ModelState } from '../scene/transformations/types';

interface ViewportProps {
  modelState: ModelState;
}

export const Viewport: React.FC<ViewportProps> = ({ modelState }) => {
  return (
    <div style={{ width: '100%', height: '600px', backgroundColor: '#1a1a1a', borderRadius: '8px', overflow: 'hidden' }}>
      <Canvas camera={{ position: [4, 2, 4], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <Environment preset="city" />
        
        <NoseModel state={modelState} />
        
        <OrbitControls makeDefault />
        <Grid args={[10, 10]} cellColor="#4f4f4f" sectionColor="#9d4b4b" fadeDistance={20} fadeStrength={1} />
      </Canvas>
    </div>
  );
}
