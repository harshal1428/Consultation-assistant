# VoiceSurg 3D — Geometry and Reconstruction

> **Prototype for simulation and educational purposes only.** The geometry is a
> plausible visualisation, not an anatomical model, a measurement instrument or a
> surgical predictor. Units are illustrative; see [§1.2](#12-units-and-calibration).

This document explains the mathematics behind the 3D head: the coordinate system,
the meshes, how each parameter moves vertices, how the deformation heatmap is
derived, how facial landmarks are detected locally, how several photographs are
fitted into one 3D shape, and how that shape and its skin texture are transferred
onto the simulation head.

It is written against the working tree of 2026-10-25. Every formula below is a
transcription of the code, with the source file named so the two can be compared.

Related documents: [Architecture](ARCHITECTURE.md) for where these modules sit in
the system, [Reference §5](REFERENCE.md#5-parameter-catalogue) for the parameter
registry, and [Developer guide §8](DEVELOPER_GUIDE.md#8-extension-recipes) for how
to add a new deformation.

---

## 1. Coordinate system, scale and invariants

### 1.1 Axes

```text
                 +Y  superior
                  │
                  │
     -X ──────────┼──────────▶ +X
   left          origin        right
                  │
                  ▼
                 -Y  inferior

                 +Z  anterior (out of the face)
                 -Z  posterior (back of the head)
```

- **X:** left (−) / right (+), mirrored about `X = 0`.
- **Y:** superior (+) / inferior (−).
- **Z:** anterior (+) / posterior (−).
- **Origin:** centre of the head.
- **Units:** scene units. The base head has semiaxes
  `rx = 0.7`, `ry = 0.92`, `rz = 0.86` (`frontend/src/scene/geometry/headShape.ts`).

The canonical face model used for reconstruction has its own frame: **centimetres,
+Y superior, +Z anterior**, origin near the head centre. Two explicit similarity
transforms bridge the frames (see [§8](#8-multi-view-reconstruction) and
[§10](#10-shape-transfer-to-the-render-head)).

### 1.2 Units and calibration

```ts
// frontend/src/scene/geometry/config.ts
sceneUnitsPerMm = (2 * rx) / 150 = 1.4 / 150 ≈ 0.009333
referenceFaceWidthMm = 150
```

A length parameter is converted exactly once:

```text
scene_delta = mm_value * sceneUnitsPerMm
radians     = degrees * (π / 180)
```

There is no other length scale anywhere in the viewer or the deformation engine.
The 150 mm reference is an **assumption**, not a measurement: the generated head
has no verified physical dimensions. Consequently:

- 1 scene unit ≈ 107 mm ≈ 10.7 cm;
- head height `2 * ry = 1.84` scene units ≈ 197 mm;
- a 2 mm command moves a vertex by ≈ 0.0187 scene units.

Every `mm` and `degrees` value in the UI is therefore an **illustrative simulation
unit**. Do not read it as a clinical measurement, and do not compare it across
patients.

### 1.3 Invariants

The geometry engine is built on four invariants. They are asserted indirectly by
the geometry tests and are the reason undo/reset are exact.

1. **Immutable baseline.** `base` positions are never written. `deformPositions`
   allocates a new array and reads only `base`.
2. **State, not deltas.** Deformation is a pure function
   `(base, ModelState, frame) → positions`. Applying the same state twice yields
   byte-identical geometry.
3. **No drift.** Weights are evaluated from baseline coordinates, never from
   already-deformed coordinates.
4. **One length pathway.** `mmToScene` is the only conversion; angles use
   `degreesToRadians` and are never multiplied by a length scale.

`initialModelState` is all zeros, so reset reproduces the baseline exactly. If a
parameter has a non-zero descriptor `default`, the panel does **not** apply it at
startup; the state still starts at zero. This mismatch is recorded in the
[Developer guide §10](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt).

---

## 2. The head meshes

Two baselines exist behind one API, `createHeadGeometry(kind)` in
`frontend/src/scene/geometry/headMesh.ts`.

| | `"model"` (default) | `"sculpted"` |
| --- | --- | --- |
| Source | `free_head.obj` supplied by the project owner, converted to `headAssetData.generated.ts` | `shapeInto()` over a unit sphere |
| Topology | closed anatomical mesh with UVs | `192 × 128` sphere ≈ 25k vertices |
| Normals | area-weighted, seam-welded smooth normals | `computeVertexNormals()` |
| Region frame | `HEAD_REGION_FRAME` (measured anchors) | `DEFAULT_REGION_FRAME` |
| Personalization | morph **or** multi-photo displacement | morph **or** multi-photo displacement |
| Licence | unverified; do not redistribute without checking | project code |

### 2.1 Realistic head

`headAsset.ts` decodes three base64 buffers (positions, UVs, `Uint16` indices) and
caches them. Because the render mesh duplicates vertices at UV seams,
`computeSmoothNormals` welds positions by rounding to 1e-5 before accumulating
area-weighted face normals. Without the weld, every seam would show as a lighting
crease.

The mesh supplies measured anatomical anchors through `HEAD_ASSET_ANCHORS`
(nasion, rhinion, pronasale, subnasale, alar wings, lips, pogonion, menton). These
become both the landmark seeds ([§5](#5-landmarks)) and the canonical anchors for
shape transfer ([§10](#10-shape-transfer-to-the-render-head)).

`HEAD_ASSET_HAIRLINE_Y = 0.4` marks the estimated hairline; texture projection
uses it to paint hair rather than skin above that height.

### 2.2 Sculpted head

`shapeInto(dx, dy, dz)` maps a unit-sphere direction to a closed, recognisable
head. It is a sum of Gaussian features faded by a front mask:

```text
x = dx * rx * (1 - 0.17 * smoothstep(0.18, -0.78, dy))     // jaw taper
y = dy * ry
z = dz * rz * (1 - 0.07 * smoothstep(0, -1, dz))           // occipital flattening
z += frontMask(dz) * Σ feature_i
```

Features include the forehead plate, brow ridge, temples, eye sockets, malar
prominences, a **single monotonic nasal dorsum** (no waist between bridge and
tip), alar wings, nostril recesses, columella, philtrum, two lip masses with an
oral fissure, the mentolabial sulcus and the chin. Eyes, lids, brows and ears are
separate meshes in `facialFeatures.ts` because a heightfield over an ellipsoid
cannot form a detached eyeball or an undercut ear.

The sculpted head is retained for the original geometry tests and as a fallback;
the realistic head is the default.

---

## 3. Region weighting

Every deformation is a weighted displacement. The weight of a vertex is a product
of three factors:

```text
w(x, y, z) = frontMask(z) * bell(x; cx, sx) * bell(y; cy, sy)

bell(v; c, s)       = exp(-((v - c) / s)^2)
frontMask(z)        = smoothstep(clamp(z / frontZ, 0, 1))
smoothstep(t)       = t^2 * (3 - 2t)
```

`frontMask` fades influence to zero at the silhouette, so the surface never
tears. Paired regions (bridge width, alar wings, chin width, jaw, cheeks) use
`bell(|x|; cx, sx)` or a sum of two bells so both sides move symmetrically; the
midline (`x = 0`) is untouched by lateral operations.

The frame is explicit (`FaceRegionFrame`), so the same engine serves both heads:

| Region | `DEFAULT_REGION_FRAME` (sculpted) | `HEAD_REGION_FRAME` (realistic) |
| --- | --- | --- |
| frontZ | 0.86 | 0.70 |
| bridge | x 0, y 0.17, σ 0.085/0.15 | x 0, y 0.075, σ 0.10/0.09 |
| bridge width | x 0.075, y 0.20, σ 0.05/0.14 | x 0.07, y 0.10, σ 0.05/0.08 |
| tip | x 0, y −0.16, σ 0.10/0.10 | x 0, y −0.0525, σ 0.09/0.07 |
| alar | x ±0.15, y −0.19, σ 0.06/0.055 | x ±0.17, y −0.125, σ 0.06/0.04 |
| upper lip | y −0.36, σ 0.13/0.03 | y −0.2265, σ 0.13/0.032 |
| lower lip | y −0.44, σ 0.14/0.036 | y −0.2985, σ 0.14/0.036 |
| chin projection | y −0.57, σ 0.13/0.075 | y −0.4485, σ 0.13/0.07 |
| chin height | y −0.56, σ 0.15/0.085 | y −0.44, σ 0.15/0.08 |
| chin width | x 0.12, y −0.56, σ 0.075/0.075 | x 0.13, y −0.4485, σ 0.07/0.07 |
| jaw width | x 0.42, y −0.5, σ 0.17/0.17 | x 0.37, y −0.2, σ 0.16/0.16 |
| jaw definition | x 0.5, y −0.47, σ 0.13/0.13 | x 0.44, y −0.18, σ 0.12/0.12 |
| cheek projection | x 0.4, y −0.05, σ 0.14/0.12 | x 0.33, y 0, σ 0.14/0.12 |
| cheek fullness | x 0.43, y −0.08, σ 0.13/0.12 | x 0.36, y −0.03, σ 0.13/0.12 |
| tip pivot | (y −0.30, z surface) | (y −0.1305, z 0.9885) |
| chin height pivot | −0.5 | −0.36 |

Region separation is a design goal, not an accident: the vertical sigma of the
lip bands is deliberately small so lip controls never reach the subnasale, and
jaw definition sits further lateral and lower than jaw width so it sharpens the
border instead of inflating the mass. Small, documented transition overlaps are
covered by `tests/geometry.test.ts`.

---

## 4. Deformation equations

`deformPositions(base, state, frame)` reads **17 core fields**. All other registry
entries are visible in the UI but do not reach this function
([§13](#13-what-is-not-modelled)).

Notation: `w_*` is the region weight at the baseline vertex, `d_*` is the
parameter delta converted to scene units, and `sign(x)` is `-1`, `0` or `+1`.

### 4.1 Nose

```text
bridge height      z' = z + d_bridgeHeight * w_bridge
bridge width       x' = x + sign(x) * d_bridgeWidth * w_bridgeWidth
tip projection     z' = z + d_tipProjection * w_tip
tip height         y' = y + d_tipHeight * w_tip
tip rotation       rotate (y, z) about the subnasale pivot by d_tipRotation * w_tip
alar width         x' = x + sign(x) * d_alarWidth * w_alar
```

Tip rotation is a weighted rotation, not a rigid one, so the tip bends smoothly
into the dorsum:

```text
relY = y' - pivotY
relZ = z' - pivotZ
a    = d_tipRotation * w_tip

y'' = pivotY + relY * cos(a) + relZ * sin(a)
z'' = pivotZ - relY * sin(a) + relZ * cos(a)
```

With the tip above the pivot (`relY > 0`), a positive angle raises the tip and
moves it slightly posterior: the "cranial rotation" direction. The weight scaling
means the rotation is full strength at the apex and fades to zero at the edge of
the tip band.

Note the order: tip projection and height are applied first, then rotation uses
the already-moved coordinates.

### 4.2 Lips

```text
upper projection   z' = z + d_upperLipProjection * w_upperLip
upper fullness     (y, z) pushed radially away from the upper-lip centre
lower projection   z' = z + d_lowerLipProjection * w_lowerLip
lower fullness     (y, z) pushed radially away from the lower-lip centre

radial push:
  ry = y - centreY
  rz = z - centreZ
  len = hypot(ry, rz) or 1
  y' = y + d_fullness * w * (ry / len)
  z' = z + d_fullness * w * (rz / len)
```

Projection translates the whole band forward; fullness expands it about a
sagittal centre, so the lip opens and plumps rather than sliding. The two lips use
different centres and independent weights, so they cannot drag each other.

### 4.3 Chin

```text
projection   z' = z + d_chinProjection * w_chinProjection
height       y' = y + d_chinHeight * w_chinHeight * (y - chinHeightPivot)
width        x' = x + sign(x) * d_chinWidth * w_chinWidth
```

The height term is a **position-dependent scale**, not a translation: vertices
below the pivot (`y < pivot`, i.e. the chin mass) move down when `d_chinHeight` is
positive, while vertices at the pivot do not move. That lengthens the chin
downward without a crease at the top. Chin width is centred nearer the midline
than jaw width, keeping the two controls independent.

### 4.4 Jawline

```text
jaw width        x' = x + sign(x) * d_jawWidth * w_jawWidth
jaw definition   x' = x + sign(x) * d_jawDefinition * w_jawDefinition
                 z' = z + 0.3 * d_jawDefinition * w_jawDefinition
```

Jaw definition adds a small anterior component (30 % of the lateral move) so the
mandibular border reads as a sharper contour rather than a pure widening.

### 4.5 Cheeks

```text
cheek projection  z' = z + d_cheekProjection * w_cheekProjection
cheek fullness    x' = x + sign(x) * d_cheekFullness * w_cheekFullness
                  z' = z + 0.35 * d_cheekFullness * w_cheekFullness
```

Both are symmetric across the midline (the `|x|` bell is applied to both sides).

### 4.6 Composition and order

All regions are evaluated **independently from the same baseline coordinates**
and their displacements are summed into `(nx, ny, nz)`. There is no sequential
"apply nose, then lips" pipeline, so region order cannot change the result.
Within a region, the only sequencing is the tip rotation, which reads the
post-projection coordinates (documented above).

`state` values pass through `safeNumber`, so `NaN` or `Infinity` behave as zero
rather than poisoning the buffer.

### 4.7 Parameter → field map

The 17 fields consumed by `deformPositions`:

| Block | Field | Effect |
| --- | --- | --- |
| Nose | `bridgeHeight` | anterior dorsum translation |
| Nose | `bridgeWidth` | lateral dorsum spread |
| Nose | `tipHeight` | vertical tip translation |
| Nose | `tipProjection` | anterior tip translation |
| Nose | `tipRotation` | weighted rotation about subnasale |
| Nose | `alarWidth` | lateral alar spread |
| Lips | `upperLipProjection` | anterior upper-lip translation |
| Lips | `upperLipFullness` | radial upper-lip expansion |
| Lips | `lowerLipProjection` | anterior lower-lip translation |
| Lips | `lowerLipFullness` | radial lower-lip expansion |
| Chin | `chinProjection` | anterior chin translation |
| Chin | `chinHeight` | downward chin scaling |
| Chin | `chinWidth` | lateral chin spread |
| Jaw | `jawWidth` | lateral jaw spread |
| Jaw | `jawDefinition` | lateral contour + 30 % anterior |
| Cheek | `cheekProjection` | anterior malar translation |
| Cheek | `cheekFullness` | lateral malar spread + 35 % anterior |

The other registry entries (`radixHeight`, `dorsalHumpReduction`,
`nasofrontalAngle`, `nasolabialAngle`, `columellarShow`,
`columellarLobularAngle`, `supratipBreak`, `tipDefinition`, `alarFlare`,
`alarBaseWidth`, `nasalLength`, `nostrilShape`, `nostrilSymmetry`,
`dorsalSeptalDeviation`, `leftRightAsymmetry`) are **registered but not
geometry-wired**. Several of them aliased onto core fields during command
application; see [Reference §5.1](REFERENCE.md#51-implementation-status).

---

## 5. Landmarks

`frontend/src/scene/geometry/landmarks.ts` defines 14 landmarks in facial
coordinates:

| Id | Label | (x, y) |
| --- | --- | --- |
| `nasion` | Nasion | (0, 0.34) |
| `rhinion` | Rhinion | (0, 0.17) |
| `pronasale` | Pronasale (tip) | (0, −0.16) |
| `subnasale` | Subnasale | (0, −0.30) |
| `alare_l` | Alare (L) | (0.15, −0.19) |
| `alare_r` | Alare (R) | (−0.15, −0.19) |
| `pogonion` | Pogonion (chin) | (0, −0.56) |
| `upper_lip` | Upper lip | (0, −0.36) |
| `lower_lip` | Lower lip | (0, −0.44) |
| `menton` | Menton (chin base) | (0, −0.60) |
| `cheek_l` / `cheek_r` | Cheek | (±0.40, −0.05) |
| `jaw_l` / `jaw_r` | Jawline | (±0.42, −0.50) |

Resolution is a three-step process so landmarks move with the deformed geometry:

1. compute the baseline 3D target — either the explicit `landmarkPositions` entry
   supplied by the realistic head's frame, or `surfacePoint(x, y)`;
2. find the nearest baseline vertex by squared distance (one pass over the mesh);
3. read that vertex's **current deformed position** at render time.

The indexed lookup is computed once per baseline. It is stable across deformation
because indices never change, so a landmark cannot "jump" to a different vertex
when a slider moves.

---

## 6. Heatmap and displacement reporting

`deformPositions` returns four things:

```ts
{
  positions,        // deformed vertices
  displacement,     // per-vertex |delta| in scene units
  colors,           // per-vertex RGB
  maxDisplacement,  // largest |delta| in this state
}
```

The heatmap normalises by the **current maximum**, not by a fixed scale:

```text
factor = displacement[i] / maxDisplacement     (0 when max < 1e-9)

factor < 0.5 : colour = lerp(#38bdf8, #22c55e, 2 * factor)
factor ≥ 0.5 : colour = lerp(#22c55e, #f43f5e, 2 * (factor - 0.5))
```

Blue → green → red therefore always spans the visible change, which keeps small
changes readable. The trade-off is that colour is *relative*: it shows where the
change is, not how large it is. Absolute magnitude is reported separately by
`maxDisplacement` and by the per-region numbers in the UI.

Epsilon guard: if `maxDisplacement < 1e-9`, every colour is the neutral blue and
no division occurs.

---

## 7. Photo detection

### 7.1 Input constraints

| Rule | Value | Source |
| --- | --- | --- |
| Accepted MIME types | PNG, JPEG, WebP | `lib/photo.ts`, `lib/multiViewPhoto.ts` |
| Maximum file size | 12 MB | same |
| Minimum dimension | 256 px | `lib/multiViewPhoto.ts` |
| Maximum dimension | 4096 px (larger = warning) | same |
| Required views | front, left profile, right profile | `REQUIRED_VIEWS` |
| Optional views | left ¾, right ¾, additional | `OPTIONAL_VIEWS` |
| Minimum landmarks per view | 100 | `MIN_LANDMARKS_PER_VIEW` |
| Detector pose limit | ≈ 50° yaw | `FACE_DETECTOR_POSE_NOTE` |

### 7.2 Detection

`services/faceLandmarker.ts` wraps MediaPipe Tasks Vision:

- model `/models/face_landmarker.task`, WASM `/mediapipe/*`, both same-origin;
- `runningMode: "IMAGE"`, `numFaces: 1`, CPU delegate;
- **478 landmarks** (468 face mesh + 10 iris);
- dynamic `import("@mediapipe/tasks-vision")` so the WASM bundle is only fetched
  when a photo is personalised, and so jsdom tests can mock it;
- the landmarker promise is cached, and reset to `null` on creation failure so a
  later retry can succeed.

The model is a trained 3D surface regressor: each landmark carries `x`, `y` and a
relative depth `z`. The depth is a real estimate, not a placeholder, but it is
weaker than the in-plane coordinates and is treated conservatively downstream.

### 7.3 Pre-processing and retries

Dark or small photographs can fall below what the detector resolves. The pipeline
builds a **detection copy** (never modifying the original):

1. upscale so the short edge is at least `DETECTION_MIN_SIZE = 512`, capped at
   `DETECTION_MAX_UPSCALE = 3×`;
2. compute 2nd/98th luminance percentiles and stretch the window with auto-levels;
3. if the window is narrower than 24 levels, skip the stretch (it is already well
   exposed);
4. retry at contrast **1.0 → 1.6 → 2.2**.

If all attempts fail, the photo is rejected with an actionable message. The
working detection canvas is released with the frame.

### 7.4 Single-photo personalization

`services/faceReconstruction.ts` reduces the 478 landmarks to anthropometric
ratios and then to **16 bounded identity coefficients** (`FaceMorph`):
`faceWidth`, `faceLength`, `foreheadHeight`, `jawWidth`, `chinWidth`, `chinLength`,
`cheekFullness`, `eyeSpacing`, `eyeSize`, `eyeHeight`, `browHeight`, `noseWidth`,
`noseLength`, `noseTip`, `mouthWidth`, `lipFullness`.

The module fits both transverse proportions (x/y ratios) and the recovered
anterior projection of the nose relative to the landmark depth spread. It is
explicit that a single frontal photo gives only a bounded depth estimate, so
depth-derived terms are conservative. This is the legacy path; the multi-view
pipeline below supersedes it for reconstruction.

---

## 8. Multi-view reconstruction

### 8.1 Inputs

- **Observations:** per-view 3D landmarks converted to an orthographic camera
  frame in **pixels**:

  ```text
  X =  x * imageWidth
  Y = -y * imageHeight
  Z = -z * imageWidth
  ```

- **Template:** the MediaPipe canonical face model, 468 vertices with real
  triangle topology, in centimetres.
- **Unknowns:** one shared shape `X` (468 points) plus, per view, a similarity
  transform `(s_v, R_v, t_v)`.

### 8.2 Objective

```text
E(X) = Σ_views Σ_i ‖ s_v R_v X_i + t_v − P_vi ‖²      (reprojection)
     + priorW · Σ_i ‖ X_i − X_prior,i ‖²                (identity prior)
     + λ      · Σ_edges ‖ X_i − X_j ‖²                  (smoothness)
```

Because the landmark indices denote the *same anatomical points* in every photo,
the shared shape couples the views: the profile photographs constrain the depth
the frontal photo cannot see. This is a genuine multi-view fit, not three
independent single-photo fits averaged.

### 8.3 Similarity fit (Horn/Umeyama)

For a fixed shape, each view's pose is the closed-form least-squares similarity
that maps the shape onto that view's observations:

1. centre both point sets on their means;
2. form the cross-covariance `S = Σ (a − ā)(b − b̄)ᵀ`;
3. build Horn's symmetric `4 × 4` matrix `N(S)` and take its largest
   eigenvector by cyclic Jacobi (64 sweeps max, 1e-20 off-diagonal cutoff);
4. convert the unit quaternion to a rotation matrix (the `w ≥ 0` half is chosen
   for a unique representation);
5. solve the optimal uniform scale `s = Σ (Ra)ᵀb / Σ ‖a‖²`, guarding
   non-finite or non-positive results back to 1;
6. translation `t = b̄ − s R ā`;
7. report RMSE, in-plane RMSE (`rmseXY`), depth RMSE (`rmseZ`) and max residual.

`count < 4` returns an infinite-error identity transform rather than attempting a
degenerate fit.

No reflection is allowed. A mirrored photograph is a different problem, handled
explicitly next.

### 8.4 Mirror detection

A horizontally flipped photo reverses the image x axis while leaving depth
unchanged. For each view the fitter also fits a mirrored copy:

```text
looksMirrored = mirroredRmse < rmse * 0.75
```

The 0.75 factor requires the mirrored hypothesis to be **markedly** better, so
ordinary asymmetry does not trigger it. The whole set is flagged when the mean
mirrored RMSE is below 75 % of the mean RMSE. A flag becomes a user-facing
warning ("appears to be mirrored … replace it"), not an automatic correction.

### 8.5 Bundle iterations

```text
repeat up to maxIterations = 12:
    pose step:  fit one similarity per view against the current shape
    shape step: solve for X given the poses
    stop when ‖ΔX‖ / ‖X‖ < tolerance = 1e-5
```

The shape step is a regularised linear least-squares problem. Each vertex has a
data diagonal `Σ_v s_v²` and a right-hand side accumulated from the back-projected
observations. Regularisation weights are expressed **relative to the mean data
weight**, so they mean the same thing at any photo resolution:

```text
priorWeight = prior     * mean(diagonal)     // default prior = 0.05
lambda      = smoothness * mean(diagonal)    // default smoothness = 0.02

(diag + priorWeight · I + lambda · L) X = rhs + priorWeight · X_prior
```

`L` is the graph Laplacian of the canonical mesh
(`L x)_i = deg_i x_i − Σ_{j∈N(i)} x_j`). The system decouples per coordinate
channel and is solved by conjugate gradient, **80 iterations**, with a relative
residual stop at 1e-12.

The identity prior `X_prior` is the canonical template mapped into the current
shape frame by a similarity fit each iteration. That constrains *proportions*
without fighting the observed scale.

Initialisation: the shape starts as the reference view's observations. The
reference view is the frontal photo when present; otherwise it is the view the
canonical template explains best. Views with fewer than
`minPointsPerView = 100` landmarks are dropped. Zero usable views throws; the
caller converts that into a `success: false` result.

### 8.6 Final alignment

After convergence the fitted shape is aligned onto the canonical template by one
more similarity fit, and `deltas = aligned − template` are stored. The aligned
shape, the deltas and the alignment transform are all returned, because the
downstream shape transfer and texture projection need them separately.

### 8.7 Defaults

```ts
DEFAULT_FIT_OPTIONS = {
  maxIterations: 12,
  smoothness: 0.02,
  prior: 0.05,
  tolerance: 1e-5,
  minPointsPerView: 100,
}
```

---

## 9. Quality metrics

`services/multiViewReconstruction.ts` produces a 0..1 score with five components.
They are **diagnostic**, not clinical.

```text
landmarkCoverage = mean over views of min(pointCount, 468) / 468
viewCoverage     = usedRequiredViews / 3                    (capped at 1)
normalisedError  = mean over views of rmsePx / faceHeightPx
fittingError     = min(1, normalisedError / 0.10)
depthConsistency = max(0, 1 − meanDepthRmse / meanFaceHeight / 0.10)
symmetryScore    = max(0, 1 − rmsAsymmetry / (0.06 * faceWidth))

overallScore = 0.25 * landmarkCoverage
             + 0.20 * viewCoverage
             + 0.35 * (1 − fittingError)
             + 0.10 * symmetryScore
             + 0.10 * depthConsistency
```

Details:

- `faceHeightPx` is `|y(menton) − y(forehead top)|`, which is yaw-independent.
- `symmetryScore` compares four symmetric landmark pairs (outer eyes, inner eyes,
  alar wings, mouth corners). `rmsAsymmetry` is the RMS of `|x_left + x_right|`;
  the scale is the outer-eye width, and 6 % of face width is the point where
  asymmetry becomes clearly visible.
- `depthConsistency` uses the per-view depth RMSE (`rmseZ`) against the mean face
  height, with 10 % as the unusable point.
- `identityMagnitudeCm` is the RMS vertex deviation from the canonical template,
  in canonical (cm) units. It is reported but not part of the score.

### 9.1 Thresholds and warnings

| Condition | Message |
| --- | --- |
| `overallScore < qualityThreshold` (0.5) | "quality is low … retake with even lighting" |
| per-view `normalisedError > 0.05` | that photo matched poorly |
| set `normalisedError > 0.01` | photos do not agree on one shape (often different people) |
| `setLooksMirrored` | check front/profile are the same side |
| `!fit.converged` | shape may be soft; add views |
| `interpupillaryDistance < 1` | eye distance implausibly small |
| any view `looksMirrored` | replace the flipped photo |

The 0.01 set-level threshold is deliberately strict: a clean fit of the same
patient lands around 0.2 % of face height, and 2 % is already visible. A warning
is a prompt to re-check the photographs, not a rejection; the clinician still
sees the preview and decides.

### 9.2 Validation gates

- At least **two** views with ≥ 100 landmarks are required; otherwise the result
  is `success: false` with an explicit error.
- Missing required views are a warning by default (`requireAllViews: false`) and
  an error when `requireAllViews: true`.
- Missing frontal view adds a warning that face width and eye spacing fall back to
  the profiles and are less reliable.
- Views with landmarks but no usable image dimensions are skipped and reported.

---

## 10. Shape transfer to the render head

The reconstruction lives on a 468-vertex open face patch; the simulation needs a
closed volumetric head. `scene/geometry/personalizedHead.ts` bridges them in four
steps.

```text
1. Align:  weighted similarity T from 12 canonical anchors to head anchors
2. Map:    head vertex p -> canonical q = T⁻¹(p)
3. Query:  k = 6 nearest canonical vertices within coverageRadius = 3.2
4. Blend:  inverse-distance weights w_k = 1 / (d_k² + 1e-4)
           delta_c = Σ w_k (shape_k − template_k) / Σ w_k
           scene_delta = coverage * scale * R * delta_c
```

The 12 anchors are nasion (168), rhinion (195), pronasale (4), subnasale (2),
upper lip (0), lower lip (17), pogonion (175), menton (152), alar wings (425/205)
and outer eye corners (263/33). Midline anchors carry weight 1.0, lateral anchors
0.8 (0.9/0.85 on the realistic head). The weighted fit minimises anchor residual;
`alignmentRmse` is reported for diagnostics.

### 10.1 Coverage fading

A head vertex is only moved where the canonical patch has authority:

```text
spatial  = 1 − smoothstep(1.1, 3.2, nearestDistance)
boundary = smoothstep(0.5, 2.5, canonical.boundaryDistance[nearest])
coverage = spatial * boundary
```

`coverageInner = 1.1` keeps the central face at full strength;
`coverageRadius = 3.2` fades to zero before the patch rim; `boundaryDistance`
prevents the open rim of the face patch from dragging the cranium. Vertices
outside coverage keep their base shape, so identity blends smoothly into the
untouched head instead of tearing.

### 10.2 Search acceleration

A brute-force 6-nearest search over ~25k head vertices × 468 canonical vertices is
~12 M distance evaluations per build — too slow interactively. A uniform grid
with cell size equal to `coverageRadius` reduces this to shell-by-shell ring
search with an early-out:

- reject immediately if the query point is further than `coverageRadius` from the
  grid bounds;
- visit only the shell of each ring, stopping when the current k-th distance is
  within `ring * cellSize` (no unvisited cell can beat it).

The grid is built once per reconstruction.

### 10.3 What is stored

`PersonalizedHeadModel` keeps the displacement, coverage, the **correspondence**
point per head vertex (the interpolated reconstructed canonical point), the
canonical shape and template, the alignment transform and RMSE, and the derived
`FaceMorph`. The correspondence is what makes texture projection possible: a head
vertex and its texture sample describe the same skin point.

The result is an immutable baseline. `applyPersonalizedDisplacement` adds it to a
copy of the base; simulation parameters are then applied on top, so undo/reset
still reproduce the same geometry.

### 10.4 Morph vs displacement

`createHeadGeometry` supports two mutually exclusive personalization paths:

- `morph`: the 16 bounded `FaceMorph` coefficients, applied to the sculpted
  surface;
- `personalized`: the per-vertex displacement from multi-view reconstruction.

They must not be combined: the displacement is computed against the neutral
surface, so also applying the morph would apply identity twice. On the realistic
head the morph is ignored when a personalized model is present; on the sculpted
head the same rule applies.

`deriveMorphFromCanonical` still produces a coarse summary for placing eyes,
brows and ears and for keeping the legacy pathway consistent. Its coefficients are
**not** the reconstruction: the full identity is the displacement field.

---

## 11. Photo texture projection

`services/faceTexture.ts` is a pure sampler over typed arrays; `patientSkinTexture.ts`
is the browser glue that reads photos and builds a canvas texture.

### 11.1 Method

For each texel of the head's UV map:

1. interpolate the head-space position, normal and correspondence point;
2. map the correspondence into each fitted view through that view's similarity;
3. project into image pixels (y up) and sample the photograph;
4. weight by view priority and surface facing;
5. choose the best-weighting view, or blend where several see the point;
6. for uncovered texels, fall back to skin colour, or hair above
   `hairlineY = 0.4` / behind `backZ`.

Because UVs are fixed to vertices, the texture deforms with the mesh and keeps its
identity when the head rotates. It is not a flat cut-out pasted on the front.

### 11.2 View priority

```text
front 1.0 > three-quarter 0.8 > profile 0.55 > additional 0.45
```

The frontal view carries the most identity detail; profiles contribute the sides
and the depth silhouette. The sampler reports `coverage`, `texturedTexels`,
`totalTexels` and per-view `viewContributions`, so the UI can say how much of the
head actually came from photographs.

### 11.3 Resolution

The pure sampler defaults to **1024 × 1024**. The service doc comment says
"1024 × 512", but the implementation default is 1024 × 1024; the comment is stale
and is noted in the [Developer guide](DEVELOPER_GUIDE.md#10-known-gaps-and-technical-debt).
Working copies of photographs are limited to a **768 px** longest edge, which
bounds memory and sampling cost.

### 11.4 Privacy

Photographs are read into canvases in the tab, reduced to working copies, sampled
into a texture, and the working canvases are released. Nothing is uploaded or
persisted, and the reconstructed texture is memory-only.

---

## 12. Performance

| Operation | Cost | Mitigations |
| --- | --- | --- |
| Base mesh build | decode base64, weld normals | cached once per baseline |
| Deformation | O(V), 17 fields, ~25k vertices | typed arrays, one pass, no allocation per vertex |
| Normal recompute | O(F) | only after a state change |
| Heatmap | O(V) | fused into the deformation pass |
| Landmark resolution | O(V) × 14 | computed once per baseline, then index reads |
| Photo detection | MediaPipe WASM inference | lazy import, retries capped at 3 |
| Multi-view fit | 12 × (V poses + 3 CG solves × 80) | small 468-vertex system; runs off the render path |
| Shape transfer | ~25k grid queries | uniform grid + ring early-out |
| Texture projection | 1024² texels × views | 768 px working photos, priority selection |

The dominant interactive cost is the per-state CPU deformation and normal
recompute. The 192 × 128 sculpted sphere (~25k vertices) was chosen as the
practical ceiling for smooth local deformation in a browser tab.

### 12.1 Failure modes

| Failure | Where handled | Result |
| --- | --- | --- |
| Non-finite parameter | `safeNumber` | treated as 0 |
| Zero max displacement | `invMax = 0` guard | neutral heatmap |
| Degenerate similarity (`count < 4`, zero variance) | `fitSimilarity` guards | identity / scale 1 / infinite error |
| No usable views | `fitMultiViewFace` throws | `success: false` with message |
| Canonical model load failure | `reconstructFaceFromMultiView` catch | `success: false` |
| Fit failure | catch | `success: false` |
| Non-convergence | `fit.converged = false` | preview still shown + warning |
| Mirrored photo | mirror heuristic | warning, never silent correction |
| Low coverage texture | sampler fallback | skin/hair colour |
| Detector unavailable in test/headless | dynamic import + `FaceReconstructionError` | actionable error |

---

## 13. What is not modelled

- **No anatomical solver.** Deformations are local Gaussian-weighted
  displacements chosen to look plausible. There is no finite-element model, no
  tissue layer, no bone or cartilage, and no volume preservation.
- **No collision or self-intersection handling.** Large combined values can push
  vertices through each other; the bounds make this unlikely but do not prevent
  it.
- **No clinical calibration.** The 150 mm facial width and all `mm` values are
  illustrative.
- **No ageing, expression, skin mechanics or healing.**
- **No prediction.** The system shows a proposed shape, not an outcome.
- **11 registered parameters do not drive geometry**, and four are explicitly
  unsupported. See [Reference §5.1](REFERENCE.md#51-implementation-status).
- **Single-photo depth is bounded.** MediaPipe's `z` is a learned estimate; the
  multi-view fit is what supplies real depth constraints, and it still assumes a
  rigid, neutral pose.

These are deliberate boundaries of a prototype, disclosed here and in the
[User guide §10](USER_GUIDE.md#10-limitations) rather than hidden behind
realistic-looking output.
