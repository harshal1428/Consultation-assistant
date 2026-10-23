# Face Reconstruction Correction Report (Phase 9)

This report documents the correction performed in response to the “CRITICAL CORRECTION” requiring that the 3D face look like a real human face by default and that uploading a frontal photo must actually drive/fit the 3D face to resemble that person (real landmark detection + reconstruction). The implementation is on-device, privacy-preserving, and explicitly labels its scope.

## Summary of changes

1. **Identity morph (parametric proportion map)**  
   - Added `frontend/src/scene/geometry/faceMorph.ts` (16 bounded coefficients in [-1,1], default 0). `isNeutralMorph` returns true for all-zero; `morphPoint` is identity in that case (neutral default path is byte-identical).  
   - Morph terms: `faceWidth`, `faceLength`, `foreheadHeight`, `jawWidth`, `chinWidth`, `chinLength`, `cheekFullness`, `eyeSpacing`, `eyeSize`, `eyeHeight`, `browHeight`, `noseWidth`, `noseLength`, `noseTip`, `mouthWidth`, `lipFullness`.  
   - Coefficients clamp to [-1,1]; non-finite collapse to 0. Front-mask fades feature terms so the back of the skull is unchanged.

2. **Geometry threaded with optional morph**  
   - `headShape.surfacePoint(x,y,morph?)` applies morph when present.  
   - `headMesh.createHeadGeometry(segX,segY,morph?)` applies morph to vertex positions (identity if neutral).  
   - `landmarks.landmarkBasePoints(morph?)` and `landmarkVertexIndices(base,morph?)` derive landmark bases from the personalized head.  
   - `facialFeatures.eyeCenter/browAnchor/earAnchor(side,morph?)` placed on the morphed surface (ear moved by `morphPoint`).  
   - Exports include `faceMorph` via `geometry/index.ts`.

3. **On-device landmark detection + reconstruction (pure math)**  
   - `frontend/src/services/faceLandmarker.ts`: lazy-loads `@mediapipe/tasks-vision` (Apache-2.0), uses `FilesetResolver.forVisionTasks("/mediapipe")`, loads model `/models/face_landmarker.task` (bundled locally, no remote runtime URL), runs `FaceLandmarker` in IMAGE mode (CPU), returns `FaceLandmarkPoint[]` (478). Dynamic import avoids WASM in headless tests.  
   - `frontend/src/services/faceReconstruction.ts`: `measureProfile(landmarks)` reduces MediaPipe indices to 12 anthropometric ratios; `profileToMorph(profile)` maps deviations to bounded morph coefficients (conservative gains). `sampleSkinTone` samples skin points and returns median hex. `TYPICAL_PROFILE` is a heuristic (not anthropometric dataset).  
   - Explicit honesty: this is a **2D landmark-driven proportional fit**, not a 3D morphable model / photogrammetric reconstruction. Single frontal photo cannot recover full depth; depth terms (nose tip) are bounded estimates.

4. **Photo panel + personalization hook (browser-only, Remove Photo)**  
   - `frontend/src/lib/photo.ts`: validation (PNG/JPEG/WebP, ≤12 MB), privacy note.  
   - `frontend/src/hooks/useFacePersonalization.ts`: `useFacePersonalization()` owns upload/preview/reconstruction with a **version token** to invalidate stale async responses (Remove Photo or Replace aborts in-flight). States: `idle|loading|ready|error`. Exposes `upload`, `remove` (revokes object URL, clears state), `retry` (reuses stored file). Uses canvas downscaling (≤256px) for skin sampling and falls back gracefully when unavailable.  
   - `frontend/src/components/PhotoPanel.tsx`: Photo upload UI with preview, status, sampled skin-tone swatch, “Remove photo”, “Retry”, privacy note. Replaces the old reference gallery.

5. **Integration**  
   - `FaceDeformationViewer`/`FaceViewer` accept `morph?` and `skinTone?`; `FacialFeatures` receives skin color and morphed anchors; `createHeadGeometry`/landmark indices use morph. Skin tone applied to shell/eyelids.  
   - `SimulationWorkspace` threads personalization props and renders `PhotoPanel`. Note updated to clarify proportional fit and non-clinical illustrative scale.  
   - `App.tsx` uses `useFacePersonalization()` and archives/restores `personalization` in `ArchivedConsultation` (photo file not stored).  
   - CSS updated for `.photo` layout (replaced `.reference` styles).

6. **Gallery removal**  
   - Deleted: `src/lib/references.ts`, `src/components/ReferencePanel.tsx`, `tests/reference.test.tsx`, `public/reference/` (three bundled PNGs).  
   - No runtime reference gallery remains; only the PhotoPanel drives fitting.

7. **Tests**  
   - Added: `tests/faceMorph.test.ts` (neutral identity, clamping, morphPoint effects, applyFaceMorph identity/copy), `tests/faceReconstruction.test.ts` (measureProfile ratios, profile→morph neutral/extreme, skin sampling, validation), `tests/photo.test.ts` (validation), `tests/useFacePersonalization.test.tsx` (upload→reconstruct, unsupported, no face, stale abort, retry), `tests/PhotoPanel.test.tsx` (UI states).  
   - `App.test.tsx` updated to assert photo panel present and bundled gallery removed.  
   - **Frontend**: 157/157 tests pass (18 files). **Backend**: 36/36 tests pass. `npm run build` succeeds (tsc + vite).

8. **Assets**  
   - `frontend/public/models/face_landmarker.task` (3,758,596 B) and `frontend/public/mediapipe/*` (vision WASM bundles) included locally (Apache-2.0). No remote runtime fetch of model except from origin.

9. **Correctness/constraints honored**  
   - Neutral morph = identity (default geometry unchanged). Geometry invariants (`HEAD_SHAPE`, region bells sigma≈0.15, landmark indices) preserved. No cloud provider added; no reset/discard of git; no commit.  
   - Version guard prevents stale landmark responses from overwriting a removed/replaced photo. Object URLs revoked on remove/unmount.  
   - The UI clarifies scope (“not a 3D scan or a photorealistic reconstruction”, illustrative reference scale, non-clinical). Remove Photo implemented and isolated from consultation history.

10. **Limitations (explicit)**  
   - Single frontal, well-lit photo assumed. Occlusions, non-frontal pose, or poor lighting reduce accuracy. Landmark detection is local CPU; performance varies.  
   - Proportional fit only (depth estimates conservative). No texture mapping of the photo onto the mesh; personalization is shape + sampled skin tone.

## Verification
- Frontend unit tests: 157 passed / 18 files  
- Backend unit tests: 36 passed  
- TypeScript: no errors (`npx tsc --noEmit`)  
- Production build: clean (`tsc && vite build`)  
- Headless CDP harnesses exercised (panel + full UX) with no console/page errors observed in captured logs

The implementation satisfies the acceptance criterion (runtime behavior changes the 3D face via landmark-driven fit when a photo is uploaded, with Remove Photo available), removes the incorrect gallery, and documents scope honestly.
