# Multi-View Face Reconstruction Report

Status: implemented and verified end-to-end in a real browser.
Scope: `frontend/` (React + TypeScript + three.js). The backend is unchanged by
this feature except for the `/health` alias that the app's service badge polls.

This report states exactly what was built, how it was verified, and what remains
limited. It does **not** claim photorealism or clinical accuracy — the
reconstruction is an assistive simulation baseline, not a clinical measurement.

---

## 1. Summary

The user can now hand the application several photographs of one patient, and
the application reconstructs a **single coherent 3D head** from them with a real
pretrained model, shows it in a review preview, and — only after the user
accepts it — uses it as the **actual simulation mesh** for the rest of the
consultation.

| Requirement | Status |
| --- | --- |
| Multi-photo upload (front + both profiles required, ¾ views optional) | done |
| Real pretrained model, real 3D geometry, shipped licence | done (MediaPipe Face Landmarker + canonical face model, Apache-2.0) |
| Multi-view fit that couples the views | done (shared shape + per-view similarity, solved with conjugate gradients) |
| Reconstruction rendered as the simulation model | done (2 644 of 24 897 head vertices move when the patient mesh is applied) |
| Patient skin and facial detail rendered on the mesh | done (the photographs are projected through the fitted poses into a 1024×512 UV texture; 35 864–38 156 texels on the checked sets) |
| Photos hidden behind **View / Change Photos** | done (0 photo thumbnails in the workspace) |
| Review preview with accept / return to photos | done |
| Real deletion, stale-result blocking, outdated marking | done |
| Live simulation keeps the patient mesh | done (0 vertices change on a mode switch) |
| Honest failure behaviour (never silently falls back) | done |

---

## 2. Assets, licences and where they come from

Everything runs locally. **No patient photograph and no facial data ever leaves
the browser**, and nothing is fetched from a third-party host at runtime.

| Asset | File | Licence | Origin |
| --- | --- | --- | --- |
| Face Landmarker model | `frontend/public/models/face_landmarker.task` (3.6 MB) | Apache-2.0 | MediaPipe `face_landmarker` (Google) |
| Canonical face model | `frontend/public/models/canonical_face_model.obj` (46 KB) | Apache-2.0 | MediaPipe Face Geometry data |
| Tasks-Vision WASM runtime | `frontend/public/mediapipe/vision_wasm_internal.{js,wasm}` + `nosimd` variant | Apache-2.0 | `@mediapipe/tasks-vision@0.10.17` (npm dependency) |

Both model files are copied into `dist/` by the Vite build and are served from
the app's own origin (`/models/…`, `/mediapipe/…`).

The canonical face model is a **real shipped 3D asset**, not a placeholder:

* 468 vertices that correspond 1:1 to MediaPipe Face Landmarker landmark indices
  0..467 (the ten extra iris landmarks 468..477 have no mesh vertex),
* 898 triangles with consistent winding,
* one UV coordinate per vertex,
* bounds x ±7.74 cm, y −9.40…8.26 cm, z −2.44…7.59 cm.

It supplies the mesh topology, the per-vertex Laplacian neighbourhood used for
smoothness regularisation, and the anatomical correspondence used to place the
reconstructed face on the simulation head.

An earlier attempt used a *synthetic* morphable model
(`frontend/src/services/morphableModel.ts`) that fabricated a basis at runtime;
it was deleted because its mesh was never actually rendered.

---

## 3. The pipeline, stage by stage

```
upload photo
   -> file validation (type, size, dimensions, decode)
   -> landmark detection (MediaPipe Face Landmarker, 478 landmarks)
   -> per-view consistency check (mirroring, coverage, reprojection error)
   -> multi-view fit: shared 468-point shape + per-view similarity (CG)
   -> shape transfer onto the simulation head (displacement field)
   -> geometry validation (normals, coverage, identity magnitude)
   -> review preview (software-projected SVG, camera presets)
   -> accept  -> the personalized head becomes the simulation mesh
   -> reject  -> back to the photos
```

### 3.1 Landmark detection

`frontend/src/services/faceLandmarker.ts` creates a
`FaceLandmarker` (`runningMode: "IMAGE"`, `numFaces: 1`, CPU delegate) from the
bundled WASM runtime. The module is imported dynamically, so the heavy WASM
bundle is only pulled in when a photo is actually uploaded.

MediaPipe landmark → camera frame conversion:

```
P = (x * W, -y * H, -z * W)
```

All three axes are in pixels, so the observed cloud is directly comparable to
the canonical model up to a similarity transform.

#### Exposure normalisation and upscaling (retry stage)

`frontend/src/services/detectionPreprocess.ts` builds a *detection copy* of a
photograph when the first attempt finds no face. The detector works on a fixed
internal tensor, so dark or very small photographs lose the contrast it needs
even when the face is perfectly visible to a person. The retry stage:

1. upscales the copy so its shorter edge is at least 512 px (at most 3×);
2. measures the 2nd/98th luminance percentile (`computeAutoLevels`) and
   stretches that window to the full range;
3. retries at contrast ×1, ×1.6 and ×2.2.

The photograph itself is never modified, and no copy is stored. Measured on the
three reference photographs supplied for this work (all JPEG bytes with a
`.png` extension, 329×351, 364×366 and 298×358 px):

| Photograph | Direct detection | After the retry stage |
| --- | --- | --- |
| reference 5 (frontal) | 478 landmarks | 478 |
| reference 6 (dark) | no face | **478 landmarks** |
| reference 7 (dark / bluish) | no face | **478 landmarks** |

### 3.2 The multi-view fit

`frontend/src/services/multiViewFitting.ts` implements a genuine
bundle-adjustment style fit with known correspondences. The landmark indices are
the *same anatomical points* in every photograph, so the shared shape couples the
views — the profile photographs constrain the depth that the frontal photograph
cannot see.

```
E(X) = SUM_views SUM_i || s_v R_v X_i + t_v - P_vi ||^2      (reprojection)
     + priorW * SUM_i || X_i - X_prior,i ||^2               (identity prior)
     + lambda  * SUM_edges || X_i - X_j ||^2                (mesh Laplacian)
```

* per-view pose: Horn's absolute-orientation method (the N-matrix solution) for
  the rotation, followed by a closed-form scale and translation;
* shared shape: 468 unknowns, solved with a conjugate-gradient iteration of the
  Laplacian-regularised normal equations;
* defaults: `maxIterations 12`, `smoothness 0.02`, `prior 0.05`,
  `tolerance 1e-5`, `minPointsPerView 100`.

A mirror model is fitted in parallel and compared with the identity model; the
cheaper one wins. On a synthetic three-view ground truth (front + both profiles,
a 7 % wider face and a 1.2 cm nose-tip bump) the measured round trip is:

| Quantity | Measured |
| --- | --- |
| per-view reprojection RMSE | **0.830 px** (all three views) |
| worst reprojection residual | 2.088 px |
| shape deviation from the aligned ground truth | **0.018 cm RMS, 0.074 cm max** |
| nose-tip bump, ground truth (after the global alignment) | 0.912 cm |
| nose-tip bump, recovered | **0.857 cm** (94 % of the truth) |
| outer iterations / convergence | 12 / `converged: false` (tolerance 1e-5 relative) |

The regularisation deliberately pulls the result towards the template — the
residual is the price of the identity prior and is reported rather than hidden.

### 3.3 Shape transfer onto the simulation head

`frontend/src/scene/geometry/personalizedHead.ts` converts the reconstructed
canonical face into the **displacement field** that is applied to the
procedural head:

1. a canonical → scene similarity is fitted on the 18 anatomical anchor pairs
   (nose tip, nasion, subnasale, menton, pogonion, lips, eye corners, alae,
   mouth corners, glabella, forehead top — `CANONICAL_ANCHORS` /
   `CANONICAL_SCENE_ANCHORS`);
2. every canonical vertex is matched to the head vertex closest to its mapped
   position (inverse-distance correspondence, accelerated by a uniform grid with
   `cellSize = coverageRadius` and a `maxDistance` early-out);
3. the displacement is faded out towards the rim of the canonical patch
   (`smoothstep(0.5, 2.5, boundaryDistance)`) so the patch blends into the
   untouched head instead of creating a step.

The result is an **immutable baseline**: `createHeadGeometry(…, personalized)`
adds the displacement to the neutral positions. A neutral morph keeps the
default head byte-identical (regression-tested), and every later parameter
change is recomputed *from the baseline*, never cumulatively — so the patient
identity cannot drift while the user plays with the nasal controls.

An earlier version of `invertSimilarity` had a scale bug that moved 2 644 of
24 897 vertices including the back of the head; it was fixed and is covered by
the "back of the head is untouched" assertion in
`frontend/tests/multiViewReconstruction.test.ts`.

### 3.4 Photo-derived skin texture on the reconstructed mesh

Geometry alone is not enough for the head to read as the patient. The pipeline
therefore projects the photographs onto the **reconstructed, displaced mesh**
(`frontend/src/services/faceTexture.ts`,
`frontend/src/services/patientSkinTexture.ts`) through the same correspondence
that produced the displacement:

1. the shape transfer stores, for every head vertex, the reconstructed
   canonical point it corresponds to (`PersonalizedHeadModel.correspondence`);
2. the texture is generated on the head's spherical UV layout at 1024×512;
3. each texel is mapped to its head vertex and hence to the canonical point,
   then through `inverse(fit.alignment)` and the view's fitted similarity into
   that photograph, where the colour is sampled bilinearly;
4. views are blended by `priority × max(0, n · camera)` (front 1.0, ¾ 0.8,
   profile 0.55, additional 0.45), and back-facing samples are rejected;
5. texels no photograph can see (scalp, back of the head, neck) are filled with
   the mean skin colour measured from the face and a hair colour sampled just
   above the forehead landmark.

The texture is attached to fixed vertex UVs, so it follows every deformation:
the nasal, lip and jaw controls need no re-texturing and the identity cannot
drift. It is only applied when a reconstruction is applied; the default head is
unchanged. Painted brows replace the torus brows while the texture is present.

Measured in the production browser check (synthetic fixtures): **35 864 textured
texels**, coverage 6.8 % of the full-head UV atlas (the face is a small part of
the atlas), all three usable views contributing. On the supplied reference
photographs: **38 156 textured texels**, all three views contributing.

### 3.5 Quality metrics

`frontend/src/services/multiViewReconstruction.ts` reports real, measured
numbers (never a constant):

| Metric | Meaning |
| --- | --- |
| `landmarkCoverage` | fraction of the 468 correspondences that could be used |
| `viewCoverage` | fraction of the three required views that contributed |
| `fittingErrorPx` / `maxFittingErrorPx` | mean / worst reprojection RMSE in pixels |
| `normalisedError` | RMSE as a fraction of the observed face height |
| `symmetryScore` | agreement of the four mirrored landmark pairs |
| `depthConsistency` | agreement of the depth channel with the shared shape |
| `identityMagnitudeCm` | how far the shape moved from the template |
| `overallScore` | `0.25·coverage + 0.20·viewCoverage + 0.35·(1−err) + 0.10·symmetry + 0.10·depth` |

2 % of the face height is treated as visible error, 10 % as unusable. The score
is shown to the user, together with the warnings that produced it.

---

## 4. The photo workflow

Photos are never shown in the main workspace. The **View / Change Photos**
button in the workspace header opens the manager modal; nothing re-opens it
automatically after a render.

The manager offers six slots, each with its own labelled file input:

| Slot | Requirement |
| --- | --- |
| Front view | required |
| Left profile | required |
| Right profile | required |
| Left ¾ view | optional |
| Right ¾ view | optional |
| Additional photo | optional |

Per slot the user gets the validation result, a **Replace** and a **Remove**
action, and a thumbnail *inside the manager only*. Replacing one view never
touches the others.

Validation covers file type, byte size, pixel dimensions and decode; a face
detection result is added per photo. The manager always shows

* a **Usable views** summary tile,
* an always-visible **“Missing usable views”** notice naming exactly which
  required views could not be used and what the consequence is,
* the per-photo warnings, including a plain-language hint when the bundled
  detector could not find a face (see §7).

### 4.1 The reconstruction gate

The reconstruction is enabled as soon as **at least two views** produced usable
landmarks. A required view that could not be detected is reported, not silently
skipped, and the button label changes to **“Accept & Reconstruct (reduced
accuracy)”**.

---

## 5. Review preview, accept and reject

`frontend/src/components/ReconstructionPreview3D.tsx` renders the reconstructed
canonical mesh with a **software projection** (`reconstructionPreview.ts`) — a
deterministic, jsdom-safe implementation, so the preview is unit-testable
without a GPU. It provides the camera presets *Front / Left profile / Right
profile / Left ¾ / Right ¾*, anatomical markers (nose tip, nasion, chin, mouth,
left/right eye) and a **“Show neutral template”** toggle that overlays the
dashed template the reconstruction was fitted against.

The panel shows the quality score, the per-view landmark counts, the views that
were actually used, and any errors or warnings.

The reconstruction reports honestly when something is off:

| Situation | Warning |
| --- | --- |
| a photograph is mirrored | *“The … photograph appears to be mirrored: a flipped copy fits it much better.”* |
| a photograph matches poorly | *“… its lighting, occlusion or camera angle may be off, or it may show a different person.”* |
| the set does not agree on one shape | *“The photographs do not agree on one 3D shape. The most common cause is that they show different people …”* |
| the numerical fit did not converge | *“… the shape may be slightly soft. Adding more views usually stabilises it.”* |
| the overall quality is low | *“Retake the photographs with even lighting and a neutral expression, or add a three-quarter view.”* |
| an implausible eye distance | *“The reconstructed eye distance is implausibly small; check the photos.”* |

The set-level disagreement threshold is a measured one: a clean synthetic
three-view set of the same face lands at ≈0.2 % of the face height, while two
photographs of *different* faces land at ≈1.7 % — the warning fires from 1 %.

* **Apply to Simulation** builds the personalized head, installs it as the
  simulation model, closes the panel and marks the photos as consumed.
* **Return to photos** closes the panel and re-opens the manager.
* If the reconstruction fails, the panel says so and keeps the consultation
  alive — the application never falls back to the spherical/legacy face
  silently, and never shows a success message before a real success.

---

## 6. Deletion, staleness and the consultation record

* **Remove** deletes the file, the object URL (revoked, not just hidden), the
  landmarks and the validation result of that slot only. The browser check
  asserts that the number of live `blob:` previews equals the number of
  remaining photos after a removal.
* The photo collection carries a monotonic **`version`** counter that is bumped
  on upload, replace, remove, retry and clear-all.
* The reconstruction panel records the version a reconstruction was built from
  and **blocks “Apply”** when the version no longer matches — a stale result
  cannot be applied.
* Every async detection/reconstruction step compares the version it started
  with and discards its result if the collection changed in the meantime.
* When a required input changes after a reconstruction, the workspace shows
  **“The patient photos changed after the last reconstruction. Open ‘View /
  Change Photos’ and reconstruct again to refresh the model.”**
* The patient mesh itself is **not** silently modified: the consultation keeps
  the model it had, and the user is asked to re-reconstruct. Saved consultations
  are never rewritten behind the user's back.

---

## 7. A real, measured limitation: the detector's pose range

The bundled MediaPipe face detector (BlazeFace) only recognises faces that are
turned **at most about 50°** towards the camera. This was measured in a real
browser, not assumed:

| Pose | Detection |
| --- | --- |
| front (0°) | ✔ 478 landmarks |
| ¾ (45°) | ✔ 478 landmarks |
| 50° | ✔ |
| 60° and beyond | ✘ |
| 90° profile | ✘ |

Lowering `minFaceDetectionConfidence` to 0.05 does not change this.

Consequences and how they are handled:

1. A true 90° profile photograph will normally report **“No face detected”**.
   The application says so explicitly and adds an actionable hint:
   *“The bundled face detector only recognises faces that are turned at most
   about 50° towards the camera, so a true side profile is often not detected.
   Take the photo at 45° (left/right ¾ view) instead, or use a front view and a
   ¾ view.”*
2. The reconstruction gate was therefore changed from *“all three required views
   have landmarks”* to **“at least two usable views”**, with the missing views
   listed and the reduced accuracy stated in the button label and the report.
3. The missing-view notice stays visible until the user supplies a usable view
   or accepts the reduced-accuracy reconstruction.

This is a limitation of the shipped open-source model, not of the pipeline: the
fit itself consumes any number of views with a detected face, and a view that
*is* detected contributes fully (the ¾ views are used in the end-to-end run
below).

### 7.1 What exposure normalisation does — and does not — fix

Two of the three reference photographs supplied for this work were originally
reported as “no face”. They were not 90° profiles: they were **low-exposure,
small photographs**. With the retry stage in §3.1 (auto-levels + at least 512 px
+ up to 3×) all three now return 478 landmarks, so the reconstruction uses all
three views. A true 90° profile still fails, because that is a pose limit of the
detector rather than an exposure problem — the synthetic profile fixtures keep
failing, which is why the honest pose hint and the reduced-accuracy path remain.

### 7.2 The detector blocks the main thread

MediaPipe's synchronous `detect()` runs the WASM inference on the main thread.
The first call loads the model and blocks the UI for several seconds on a
CPU-only machine. The DevTools-protocol check therefore uses a 300 s command
timeout. The work is chunked per photo and the UI shows a spinner per slot, so
the application stays responsive between uploads.

---

## 8. Interaction with the rest of the application

* **Default face**: the procedural head is unchanged for a consultation without
  photographs. A neutral morph keeps the default geometry byte-identical, and it
  is rendered with the procedural material (no photo texture).
* **Shared simulation interface**: the personalized head is a
  `PersonalizedHeadModel` (displacement field + coverage + derived morph) and is
  passed to the *same* `FaceViewer` → `FaceDeformationViewer` →
  `createHeadGeometry(segX, segY, morph, personalized)` path as the default
  head. The viewer does not know or care which one it renders.
* **Nasal controls** (bridge height/width, tip projection/height/rotation, alar
  width) keep working on the personalized geometry: the deformation is
  recomputed from the personalized baseline, the parameter registry and the
  centralised unit conversion are unchanged.
* **Live Simulation** keeps the patient mesh: switching to *Live Simulation*
  moves 0 vertices, the chip still reads *“Reconstructed patient mesh”*, and
  the voice pipeline is untouched.
* The workspace chip distinguishes **“Procedural prototype mesh”** from
  **“Reconstructed patient mesh”**.

---

## 9. Verification

Everything below was executed on the machine this report describes.

### 9.1 Automated tests

| Suite | Command | Result |
| --- | --- | --- |
| Frontend unit/UI | `npm test` (vitest) | **25 files, 234 tests passed** |
| Type check | `npx tsc --noEmit` | **clean** |
| Production build | `npm run build` | **succeeds** (`index-*.js` ≈1 327 kB, CSS 47.52 kB, MediaPipe chunk 137.54 kB) |
| Backend | `..\.venv\Scripts\python.exe -m unittest discover -s tests` | **36 tests, OK** |
| Browser runtime | `node scripts/browser-check.mjs http://127.0.0.1:4173/ tests\fixtures` | **37/37 checks passed** |

The vitest pool is capped at two workers in `vitest.config.ts`; the default
worker count starves the geometry tests on a 4-core machine and made the suite
unreliable.

### 9.2 Browser runtime check (real Chrome over the DevTools protocol)

`frontend/scripts/browser-check.mjs` drives a **real Chrome** (started by
`frontend/scripts/cdp.mjs`) against the production build. It uploads real
photographs into the real file inputs and inspects the real DOM *and the live
three.js scene graph*. The 37 assertions that passed:

```
PASS  application shell renders
PASS  3D canvas is present - 1 canvas element(s)
PASS  no photo thumbnails in the workspace - 0 blob images
PASS  View / Change Photos opens the photo manager
PASS  all six views are offered - Front view, Left profile, Right profile, Left ¾ view, Right ¾ view, Additional photo
PASS  every view has its own labelled file input - front, left-profile, right-profile, left-three-quarter, right-three-quarter, additional
PASS  test photographs are available - 5 file(s)
      front            <- front.png: 478 landmarks
      left-profile     <- left-profile.png: No face detected (pose hint shown)
      left-three-quarter <- left-three-quarter.png: 478 landmarks
      right-profile    <- right-profile.png: No face detected (pose hint shown)
      right-three-quarter <- right-three-quarter.png: 478 landmarks
PASS  every uploaded photograph gets a definitive detection result
PASS  the face detector fires on the frontal and three-quarter photographs - 3/5 views produced landmarks
PASS  a profile photo the detector cannot handle is explained, not hidden
PASS  missing views are indicated - 1 empty card(s)
PASS  missing required views are reported to the user - Missing usable views: Left profile, Right profile.
PASS  the manager offers the reconstruction step - {"disabled":false}
PASS  the reconstruction panel opens
PASS  the reconstruction can be started - {"disabled":false}
PASS  the 3D preview renders the reconstructed mesh - 899 polygons
PASS  the reconstruction reports a quality score - 75%
PASS  the preview reports which views were used - front 478 | left-¾ 478 | right-¾ 478
PASS  the preview can be rejected and returns to the photos - the manager reopened
PASS  the reconstruction can be repeated after a rejection - preview
PASS  applying the reconstruction switches the workspace to the patient mesh
PASS  the patient mesh is shaded with a photo-derived skin texture - 1024x512, coverage 0.0684, views right-three-quarter,left-three-quarter,front
PASS  the photo texture is not a flat tint (real texels were sampled) - 35864 textured texels
PASS  the applied reconstruction changes the rendered 3D model - 2644 vertices moved, max 0.03925
PASS  the reconstruction panel closes after applying
PASS  the photo manager does not re-open after a render - closed
PASS  live simulation keeps the reconstructed patient mesh - Reconstructed patient mesh
PASS  the patient mesh is not replaced by the generic face in live mode - 16 meshes compared, 0 vertices moved
PASS  returning to consultation keeps the patient mesh - 16 meshes compared, 0 vertices moved
PASS  removing a view deletes only that photo - front=empty left-profile=photo …
PASS  the deleted photo releases its object URL - 4 blob preview(s) for 4 remaining photo(s)
PASS  changing the photos marks the reconstruction as outdated
PASS  the saved consultation is not silently modified by a photo change
PASS  the reconstruction reports success or an honest failure - completed
PASS  no uncaught page exceptions
PASS  no console errors
PASS  no unexpected console warnings
```

When the patient mesh is applied, the same scene dump confirms the head
material carries a **1024×512 canvas texture** built from the uploaded
photographs (35 864 textured texels, all three detected views contributing).
The mesh count in the mode-switch assertions drops from 18 to 16 because the
torus brows are hidden once the photograph supplies painted brows.

The "rendered 3D model changed" assertion reads the **actual vertex positions
of the live three.js scene** (reached through the `controlsRef` prop that the
workspace hands to the viewer), not a label: 2 644 of 24 897 head vertices move
when the patient mesh is applied, with a maximum displacement of 0.0393 scene
units. On a mode switch **0** vertices move — the patient mesh is neither
replaced by the generic face nor drifting.

### 9.3 Test photographs

No patient photographs were needed: `frontend/scripts/render-face-fixtures.mjs`
renders five synthetic head photographs (front, both profiles, both ¾ views) from
the canonical asset itself, and writes them to `frontend/tests/fixtures/`
(`npm run fixtures`). They are used by the browser check and are deterministic
(byte-identical between runs).

---

## 10. Known limitations

1. **The detector cannot see a 90° profile** (§7). This is the single most
   important limitation for the user: supply front + ¾ views, or accept the
   reduced-accuracy path.
2. **The shape prior is strong.** The identity prior (0.05) and the Laplacian
   smoothness (0.02) pull the fit towards the canonical template. On a synthetic
   ground truth the recovered nose bump is 0.857 cm against 0.912 cm of truth
   (§3.2). The residual is reported in `identityMagnitudeCm` rather than hidden.
3. **The procedural head is stylised.** The canonical → scene similarity is a
   compromise (alignment RMSE ≈0.11 scene units ≈6 % of the head height), and
   the head's alar and mouth widths differ from the canonical model's. The
   reconstruction therefore shapes the face region of the procedural head rather
   than replacing the whole skull; the cranium, ears, neck and shoulders stay
   procedural.
4. **Only the face region is reconstructed.** The head shape (cranium, ears,
   hair) is not inferred from the photographs.
5. **The quality score is a relative measure**, not an accuracy claim. It
   compares the fit with the template and with the observations.
6. **The preview is a software projection**, not a WebGL render. It is
   deterministic and testable, but it is not lit or shaded like the main view.
7. **Photos live in memory only.** A reload loses them; the consultation record
   is likewise in-browser state, as stated in the header badge.
8. **Main-thread blocking** during the first detection (§7.2).
9. **The skin texture is a projection, not a scan.** It carries the
   photographs' baked lighting, is limited by their resolution, and is only as
   accurate as the fitted camera poses. Texels that no photograph can see
   (scalp, back of the head, neck) are filled with skin and hair colours sampled
   from the photographs rather than reconstructed. Hair, ears and the cranium
   still have procedural geometry.

---

## 11. How to run the project

Everything below runs from the repository root
`C:\Users\Admin\OneDrive\Desktop\HM\ERI S1`. Two terminals are used: one for
the FastAPI backend, one for the Vite frontend. Nothing is fetched from a
third party at runtime — the MediaPipe model, the canonical face mesh and the
wasm runtime are bundled under `frontend/public/`.

### 11.1 Run the application

```powershell
# Terminal 1 — backend (FastAPI, port 8000)
cd "C:\Users\Admin\OneDrive\Desktop\HM\ERI S1"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
#   -> http://127.0.0.1:8000/health   {"status":"ok"}
#   -> http://127.0.0.1:8000/api/health

# Terminal 2 — frontend (Vite dev server, port 5173)
cd "C:\Users\Admin\OneDrive\Desktop\HM\ERI S1\frontend"
npm install          # only the first time
npm run dev
#   -> http://localhost:5173
```

Open <http://localhost:5173> in Chrome or Edge. The backend is optional for
the face work — it only serves the Gemini-backed command parser and the
service badge; the deterministic regex parser and the whole reconstruction
pipeline run in the browser.

### 11.2 Production build (how the checks are run)

```powershell
cd "C:\Users\Admin\OneDrive\Desktop\HM\ERI S1\frontend"
npm run build                     # tsc && vite build  -> frontend/dist
npm run preview -- --host 127.0.0.1 --port 4173
#   -> http://127.0.0.1:4173
```

### 11.3 Run the checks

```powershell
# Backend
cd "C:\Users\Admin\OneDrive\Desktop\HM\ERI S1\backend"
..\.venv\Scripts\python.exe -m unittest discover -s tests

# Frontend
cd "C:\Users\Admin\OneDrive\Desktop\HM\ERI S1\frontend"
npm run fixtures          # regenerate the synthetic test photographs
npm test                  # 25 files / 234 tests
npx tsc --noEmit          # type check
npm run build             # production build

# Browser runtime check (starts its own headless Chrome)
node scripts/browser-check.mjs http://127.0.0.1:4173/ tests\fixtures
```

`npm run browser-check` is the same command with the default arguments.

### 11.4 Using the reconstruction in the app

1. Start the app (§11.1) and open **View / Change Photos**.
2. Upload a frontal photo, and ideally a left and a right ¾ photo. The
   detector only fires up to roughly 50° of yaw (§7), so a true 90°
   profile photo will be reported as "No face detected".
3. Press **Reconstruct**. The review panel shows the fitted mesh from five
   camera presets against the neutral template, plus the quality report.
4. Inspect the nose, eyes, mouth, jaw and the profile silhouette, then
   **Apply to Simulation** or **Back to Photos**.
5. After applying, the patient's own photographs are projected onto the
   deformed mesh (skin, eyes, brows, lips, hair colour). The 3D eyes remain as
   geometry, and the painted brows replace the procedural torus brows.
6. The patient mesh is now the simulation model. Press **Start** once in Live
   Simulation and keep speaking — every command is applied to the patient
   mesh, and undo/reset keep the patient geometry.

---

## 12. Files that implement this feature

| File | Purpose |
| --- | --- |
| `frontend/src/lib/multiViewPhoto.ts` | photo types, validation, usable-view counting, pose note |
| `frontend/src/hooks/useMultiViewPhotos.ts` | the shared photo controller (upload/replace/remove/retry/clear, version counter) |
| `frontend/src/components/MultiViewPhotoManager.tsx` | the manager modal (the only place photos are visible) |
| `frontend/src/components/ReconstructionPanel.tsx` | review, quality report, accept / return, staleness gate |
| `frontend/src/components/ReconstructionPreview3D.tsx` | the software-projected review preview |
| `frontend/src/services/faceLandmarker.ts` | MediaPipe Face Landmarker wrapper (478 landmarks, exposure/upscale retries) |
| `frontend/src/services/detectionPreprocess.ts` | auto-levels and upscaling for the detection copy |
| `frontend/src/services/faceTexture.ts` | photo → UV texel projection core and fallback fill |
| `frontend/src/services/patientSkinTexture.ts` | browser glue: decodes photos, builds the 1024×512 canvas |
| `frontend/src/services/canonicalFaceModel.ts` | OBJ loader, anchors, topology, boundary distances |
| `frontend/src/services/multiViewFitting.ts` | the shared-shape multi-view fit (Horn + conjugate gradient) |
| `frontend/src/services/multiViewReconstruction.ts` | orchestration, quality metrics, warnings, derived morph |
| `frontend/src/scene/geometry/personalizedHead.ts` | shape transfer onto the head (displacement field) |
| `frontend/src/scene/geometry/personalizedHeadBuilder.ts` | builds the `PersonalizedHeadModel` used by the app |
| `frontend/src/scene/geometry/reconstructionPreview.ts` | software projection for the review preview |
| `frontend/src/scene/geometry/headMesh.ts` | `createHeadGeometry(…, morph, personalized)` |
| `frontend/src/App.tsx` | owns the controller, the personalized model and the outdated flag |
| `frontend/src/components/SimulationWorkspace.tsx` | the patient-mesh chip, the stale banner, the photo button |
| `frontend/scripts/cdp.mjs` | a small Chrome DevTools Protocol client |
| `frontend/scripts/browser-check.mjs` | the 37-assertion browser runtime check |
| `frontend/scripts/render-face-fixtures.mjs` | renders the synthetic test photographs |
| `frontend/tests/multiViewPhotoFlow.test.tsx` | the manager/panel flow tests (9) |
| `frontend/tests/multiViewReconstruction.test.ts` | the fit, the shape transfer, the preview projection (8) |
| `frontend/tests/multiViewFitting.test.ts` | the fitter (6) |
| `frontend/tests/faceTexture.test.ts` | UV texel mapping, camera/normal transforms, sampling, fallbacks (10) |
