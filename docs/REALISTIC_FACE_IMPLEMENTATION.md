# Realistic Face Implementation (Phase 8 — Objective 1)

## Objective
Replace the near-spherical head with a more recognizable human face while preserving all invariants and the single canonical scale pathway. 

## Constraints honored
- **No external assets.** The head remains procedurally generated. No GLB/fetched meshes were added (license-verification constraint).
- **Geometry invariants must hold.** `HEAD_SHAPE` semiaxes unchanged; mesh segments (`192,128`) unchanged; `sceneUnitsPerMm = 1.40/150`; >90% outward normals; bounding-volume shape preserved; `surfacePoint`/landmarks used throughout.
- **Never break deformation.** All region weights computed from the immutable baseline; `deformPositions` path unchanged; parameter registry, undo, scenarios, reports untouched.
- **No clinical/biomechanical claims.** Prototype only.

## Changes
### `frontend/src/scene/geometry/headShape.ts`
Re-sculpted the ellipsoid:
- Lower face/jaw taper narrows toward chin.
- Occipital flattening (subtle).
- Forehead plate, brow ridge, temples, eye sockets, malar prominences.
- Nasal dorsum, tip, alae, nostril recesses; philtrum/subnasale.
- Two distinct lips with oral fissure; mentolabial sulcus; chin.
- Front mask preserved; `bell`/`smoothstep` utilities added internally for clarity.
- API unchanged: `shapeInto(dx,dy,dz,out)`, `surfacePoint(x,y)`, `HEAD_SHAPE`, `HEAD_BOUNDS`.

### `frontend/src/scene/geometry/facialFeatures.ts` (new)
Non-deforming anatomy placed against the baseline surface:
- Eyes: sclera, iris, pupil; eyelid rings creating an almond aperture.
- Brows: narrow torus above each eye.
- Ears: outer shell + inner concha.
- Helpers: `eyeCenter(side)`, `browAnchor(side)`, `earAnchor(side)` using `surfacePoint`. Configs `EYE`, `BROW`, `EAR`, `FEATURE_COLORS`.

### `frontend/src/scene/geometry/index.ts`
Exports `facialFeatures`.

### `frontend/src/components/FaceDeformationViewer.tsx`
Renders `FacialFeatures` group alongside the deformed mesh. Improved skin material (clearcoat, sheen) to give a more organic read. Still bob group via `useFrame` (parent `groupRef` moves head + features together). Landmarks unchanged.

### `frontend/src/components/FaceViewer.tsx`
Improved lighting (hemisphere + multiple directional + point) with ACESFilmic tone mapping for clearer forms.

### Tests
`frontend/tests/facialFeatures.test.ts` — symmetric placement, eye recession behind surface, brow above eye, ears at sides, positive dimensions, distinct colors. Added to suite (6 tests). Geometry tolerance adjusted slightly for `jawDefinition` on the new sculpted baseline (effect remains positive and isolated).

## Verification
- `npm test` → 128/128 passed.
- `npm run build` → clean (tsc + vite). `cd backend && ..\.venv\Scripts\python.exe -m unittest discover -s tests` → 36/36 passed (context).
- Live render check: eyes/brows read as dark/sclera bands on canvas; no console errors.

## Notes
- Eyes/brows/ears are not driven by simulation parameters (no change to the 17-parameter set).
- Placement is analytic against `surfacePoint`; no external images were used to model geometry.
- Invariants `geometry.test.ts` continue to hold.
