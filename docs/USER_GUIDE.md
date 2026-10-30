# VoiceSurg 3D — User Guide

> **Prototype for simulation and educational purposes only.** VoiceSurg 3D is not a
> medical device, not a diagnostic tool and not a surgical planning system. It does
> not predict outcomes, and its units are illustrative. See
> [§10 Limitations](#10-limitations).

This guide is for the person using VoiceSurg 3D in a consultation or a
demonstration: what each mode does, how to speak or type a command, what every
status label means, how to compare options, how to use photographs, and how to
recover when something goes wrong.

If you are installing or changing the software, read the
[Developer guide](DEVELOPER_GUIDE.md) instead.

---

## 1. What VoiceSurg 3D is

VoiceSurg 3D is a browser-based workspace where you describe a facial change in
words and see it applied to a 3D head. A typical sentence is:

> "Reduce the nasal bridge height by 2 millimetres."

The system interprets the sentence into an explicit instruction, validates it
against safe simulation bounds, and shows you exactly what it understood. Nothing
changes until you confirm. You can then review the change, adjust individual
parameters with sliders, save alternatives, compare them side by side, and export
a summary.

What it is good for:

- exploring a proposed change and explaining it to a patient;
- comparing conservative and more assertive options;
- keeping a record of what was discussed;
- teaching how a parameter maps to a visible shape change.

What it is **not**:

- a measurement or imaging device;
- a predictor of surgical outcome;
- a patient record system;
- a substitute for clinical judgement.

---

## 2. Before you start

### 2.1 What you need

| Requirement | Notes |
| --- | --- |
| Chrome or Edge | Recommended. Web Speech works best here. |
| Microphone | Optional. Typed commands work everywhere. |
| Backend running | Needed for voice/typed parsing. The 3D view still works without it. |
| Photographs | Optional, for personalisation. 3 required + 3 optional views. |

### 2.2 Start the app

From the repository root, in two terminals:

```powershell
# Terminal 1 — parsing service
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# Terminal 2 — workspace
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 2.3 Check the header

| Indicator | Meaning |
| --- | --- |
| **Parsing service: online** | Voice and typed commands can be interpreted. |
| **Parsing service: offline** | The backend is unreachable. Sliders and the 3D view still work; commands cannot be parsed. |
| **Active · temporary** | The workspace state is edited in browser memory; it is auto-saved to the local SQLite archive and can be restored from **Previous consultations**. |
| **Simulation prototype** | Reminder that this is not a clinical device. |

The service indicator is probed every 15 seconds and recovers on its own.

### 2.4 Session lifetime

A session starts automatically. Everything — transcript, applied changes,
scenarios, live log — is held in memory while you work, and a debounced copy is
saved to the local SQLite archive. Ending the consultation, starting a new one or
pressing **Archive current** writes immediately ([§7.5](#75-previous-consultations-sqlite)).
Reloading the page therefore does not lose the archived consultation; restore it
from the **Previous consultations** panel. A warning dialog still protects you if
you try to start a new consultation with unsaved work.

---

## 3. The workspace at a glance

```text
┌──────────────────────────────────────────────────────────────┐
│ Header: mode switch · service status · reset · end · new     │
├────────────────────────────────┬─────────────────────────────┤
│                                │  Right rail                 │
│   3D Simulation                │  · Consultation  or         │
│   · Before / Current / Compare │    Live simulation          │
│   · landmarks, mesh, heatmap   │  · Proposed change review   │
│   · parameter differences      │  · Simulation parameters    │
│                                │  · Scenarios                │
│                                │  · Session history          │
│                                │  · Previous consultations   │
└────────────────────────────────┴─────────────────────────────┘
```

On narrower screens the rail moves below the viewer at 1180 px, and the layout
becomes a single column at 720 px.

### 3.1 Viewer controls

| Control | Effect |
| --- | --- |
| **Before / Current / Compare** | Show the unmodified head, the current simulated head, or two states side by side. |
| **Landmarks** | Overlay the anatomical landmarks that follow the deformation. |
| **Wireframe** | Show the mesh topology. |
| **Heatmap** | Colour vertices by displacement (blue → green → red, relative to the largest change). |
| **Reset view** | Restore the camera, not the parameters. |

In **Compare**, choose any two sources (baseline, current, or a saved scenario) for
the left and right panes. A table below lists only the parameters that differ and
the delta between them.

### 3.2 Operating modes

| Mode | What it does | Best for |
| --- | --- | --- |
| **Consultation** | Every utterance becomes a proposal you review before applying. | Careful, explain-as-you-go conversations. |
| **Live Simulation** | Each utterance is applied immediately if it is safe, and logged. | Rapid exploration and "what if" demos. |

Both modes share one head, one history and one set of parameters. Switching modes
does not reset anything. Microphone capture stops when you leave Live Simulation.

---

## 4. Consultation mode

### 4.1 The flow

```text
speak or type → proposal → review → confirm → change applied → history
```

A new utterance cancels any proposal still awaiting review. That is deliberate: a
later sentence supersedes an earlier one.

### 4.2 Speaking

1. Choose the recognition language: **English (en-US)**, **Hindi (hi-IN)** or
   **Marathi (mr-IN)**.
2. Press the microphone button. Its label changes to **Stop listening**.
3. Say one instruction. The final transcript is sent automatically; interim text is
   shown while you speak.
4. Press **Stop listening** if the browser does not stop on its own.

The parser's vocabulary is English. Selecting Hindi or Marathi changes what the
browser transcribes, but the backend still expects English anatomical terms.

If the browser does not expose the Web Speech API, the panel says so and the typed
field remains available.

### 4.3 Typing

Use **Type a command** and press **Send**. Example commands:

```text
Reduce the bridge by 2 millimetres
Raise the nasal tip 1.5 mm
Rotate the tip up by 5 degrees
Narrow the alar width by 1 mm
Increase chin projection by 3 mm
Make the jawline wider by 2 mm
Add fullness to the upper lip by 1 mm
```

Compound sentences are supported:

```text
Raise the tip by 2 millimetres and reduce the bridge by 1 millimetre
```

Each clause becomes its own instruction. A change set is applied **in full** by
default; see [§4.5](#45-confirming-a-change-set).

### 4.4 Reading a proposed change

The review panel says:

> **Proposed change** or **Change set** — *N instructions parsed from your command.
> Nothing is applied until you confirm.*

Each instruction card shows:

| Field | Meaning |
| --- | --- |
| **Instruction N** | Position in the change set. A microphone icon means voice; sliders mean manual. |
| Quoted text | The exact phrase the instruction came from. |
| **Region** | Anatomical region, or "Not recognised". |
| **Parameter** | `height`, `width`, `projection`, `rotation`, `fullness` or `definition`. |
| **Action** | `increase`, `decrease`, `narrow`, `widen`, `rotate`, `raise` or `lower`. |
| **Proposed change** | Signed magnitude, e.g. `−2 mm`; both requested and normalised values are shown when a unit was converted. |
| **Parser confidence** | **High** (≥ 0.85), **Medium** (≥ 0.60), **Low** (< 0.60), and whether it came from `rules` or the language model. |

#### Status vocabulary

| Chip | Backend status | What it means | Can it be applied? |
| --- | --- | --- | --- |
| **Ready to apply** | `ok` | Valid, in range, supported region/parameter. | Yes |
| **Needs clarification** | `needs_clarification` | Missing value, missing direction, out-of-range request, or a qualitative request ("more defined"). | Not until resolved |
| **Not supported** | `unsupported` | The region/parameter pair is not modelled. | No |
| **Invalid** | `invalid` | Wrong unit for the parameter, negative value, or a unit the system does not accept (inches). | No |
| **No change** | `no_change` | The requested magnitude is zero. | Nothing to apply |

When a status is not `ok`, the card explains why in a message. Out-of-range
requests are **never silently clamped**; you get a suggestion instead.

### 4.5 Confirming a change set

| Button | When it appears | Effect |
| --- | --- | --- |
| **Confirm & simulate (N)** | Always | Applies the whole set. Disabled while any instruction is not applicable. |
| **Apply only valid (N)** | Some but not all instructions are applicable | Applied the applicable subset deliberately. |
| **Reject all** | Always | Discards the proposal; nothing changes. |

The "apply in full" rule exists so a compound sentence cannot be half-applied
without you noticing.

### 4.6 Resolving a blocked instruction

For **Needs clarification**, the card offers:

- **Accept adjusted X mm** — the suggested in-range replacement;
- **1 mm** / **2 mm** — quick fills when no magnitude was heard;
- **Custom value** — open the editor.

For any instruction, **Edit** lets you change region, parameter, operation, value
and unit, then **Save edits**. Saving promotes a resolvable
`needs_clarification`/`unsupported` instruction to `ok`, but it never changes the
magnitude on its own. You can also remove an instruction with the **×** button.

### 4.7 Spoken confirmation

Tick **Spoken confirmation after applying a change** to hear a short sentence after
each applied command. It uses the browser's speech synthesis and is off by default.

### 4.8 After applying

The change appears in **Session History** with its source, target, parameter,
signed value and time. From there you can:

- **Undo** a specific change (the model is replayed without it);
- **Reset** the simulation to baseline (confirmed if there is work);
- **Save report** to download a Markdown summary.

**Reset simulation** in the header clears all working parameters and cancels any
pending proposal. It does not end the consultation.

---

## 5. Live simulation mode

Live mode is for rapid exploration. There is no review step, so safeguards are
stricter.

### 5.1 The flow

```text
speak → parse → per instruction: apply if safe, otherwise log why
```

Press **Start live simulation**. The panel shows **Listening · changes apply
automatically**. Each instruction is evaluated independently:

| Condition | Result |
| --- | --- |
| `status === "ok"` | Candidate |
| Has `adjusted_value` (out of range) | **Not applied** — logged as out of range |
| No parameter mapping in the UI | **Not applied** — logged |
| Value equals the current value | **Not applied** — no change |
| Otherwise | Applied immediately |

A failure is not an error state: it becomes a row in the change log with a reason.
A network failure is also logged rather than replacing the panel with a banner.

### 5.2 The change log

Every instruction is logged, applied or not, newest first:

```text
[Applied]  14:32:07 · live_voice
“raise the tip by two millimetres”
nasal tip / height (tipHeight) · requested 2 mm → normalised 2 mm · 14 → 16 mm
```

Each row shows the status chip, time, source, utterance, target/parameter/mapped
key, requested and normalised values, the before → after change, and the reason
when not applied.

Status chips in the log are: **Applied**, **Needs clarification**,
**Unsupported**, **Out of range**, **No change**, **Not applied**.

### 5.3 Typing in live mode

Use **Type an instruction instead** and press **Apply**. This is useful when the
microphone is unavailable or the room is noisy.

### 5.4 Exporting the log

**CSV**, **JSON** and **PDF** download the current change log. Export is disabled
while the log is empty. These files are generated in the browser and contain the
utterances and their outcomes — treat them as you would any consultation note.

### 5.5 Stopping

**Stop live simulation** releases the microphone. The consultation stays active,
the history stays intact, and you can switch back to Consultation mode. Ending the
consultation or starting a new one also stops live capture.

---

## 6. Manual parameter control

The **Simulation Parameters** panel is the precise, deterministic counterpart to
voice. Open a region — **Nose**, **Lips**, **Chin**, **Jawline**, **Cheeks** — and
drag a slider. A badge shows how many parameters in that region are currently
non-zero.

Each control shows:

- the parameter's full label and a short hint;
- the current value as `+2 mm` or `−5 °`;
- the slider between the parameter's declared minimum and maximum;
- a reset button that sets it to 0.

Dragging a slider:

- creates or updates **one absolute manual command** for that parameter, so the
  value is the slider position, not a delta;
- replaces any previous manual command for the same parameter;
- does not remove voice history; the manual value is folded in on top.

The panel shows **28** adjustable parameters across the five regions. Some are
**registered but not yet geometry-wired** — moving them may not visibly change the
head. The affected controls are listed in
[Reference §5.1](REFERENCE.md#51-implementation-status); the short version is that
11 newly added clinical parameters currently alias onto nearby core controls when
used, so their own sliders can appear to snap back. If a slider does not hold its
value, use the core parameter instead (for example **Nasal bridge height** rather
than **Radix height**).

Sliders are the most reliable way to demonstrate a change when the parser or the
backend is unavailable.

---

## 7. Scenarios, comparison, reports and archive

### 7.1 Saving a scenario

1. Set the parameters you want (by voice or sliders).
2. In **Scenarios**, type a name such as `Conservative tip lift`.
3. Press **Save**.

A scenario stores the current parameter state, the command ids that produced it,
a timestamp and optional notes. The hint under the name field summarises the
current working values. Scenarios live in the current session and are included
when the consultation is archived to SQLite; restoring a previous consultation
restores its scenarios too.

### 7.2 Loading, renaming, deleting

| Action | Effect |
| --- | --- |
| **Load** | Rewrites history to the scenario's state and logs a `scenario_loaded` event. |
| **Rename** | Edits the label only. |
| **Delete** | Removes the snapshot (with confirmation). Cannot be undone. |
| The check button | Marks the scenario as the final selected option for the report. |

### 7.3 Comparing

Switch the viewer to **Compare**, then choose a source for **Left** and **Right**.
Sources include the baseline, the current state and saved scenarios. The viewer
renders both states; the **Parameter differences** table lists only non-zero
differences with a signed **Δ** column.

This is the recommended way to show a patient "option A versus option B".

### 7.4 Reports

**Session History → Save report** downloads
`VoiceSurg_Consultation_<id>.md`. The report contains the session summary,
transcript, applied changes, scenarios and the selected final scenario. It is
generated entirely in the browser.

The live change log has its own exports (CSV/JSON/PDF) for audit-style records.

### 7.5 Previous consultations (SQLite)

Every consultation is stored against a patient and surgeon in a local SQLite
database on the backend machine (`backend/app/data/voicesurg.db`). Enter the
**Patient name** and **Surgeon** in the *Patient & surgeon* panel; the patient
ID/MRN is optional. A consultation cannot be archived until both required
fields are filled.

**New consultation** opens a dialog for the next patient's identity, then clears
the previous patient's workspace and starts an independent session. Opening a
stored consultation restores its patient identity together with its transcript,
planning state and scenarios. Photos, reconstruction, personalization and live
input from the previous session are cleared, so one patient's work cannot leak
into another's.

The panel header shows **SQLite database** when the backend is reachable and
**Browser fallback** when only the on-device IndexedDB cache is available.

Records are written:

- when you press **Previous consultations → Archive current**;
- automatically when a consultation is ended;
- automatically before **New consultation** discards the current work;
- on a debounced (1.2 s) save while you are working.

Each record contains the patient/surgeon identity, label, timestamps, status,
change/scenario counts, full model state, Markdown summary, live events,
transcript, proposals, timeline events and scenarios. **Photographs are never
archived.** The list is grouped by patient, using the patient ID when present
and otherwise the patient name.

From the list you can:

| Action | Effect |
| --- | --- |
| **View consultation summary** | Expands the stored Markdown summary in place. |
| **Restore** | Rewrites the working state and re-opens the full session narrative (transcript, proposals, events, scenarios) as an active consultation. |
| **Delete** | Removes one record from the database and the local cache. |
| **Clear all** | Removes every archived record. |
| **Refresh archive** | Reloads the list from SQLite. |

If the backend is offline, new records are kept in the browser cache and the
panel falls back to it; they are migrated into SQLite the next time the backend
is reachable. The SQLite file is unencrypted — treat it like any other local
patient-data file.

---

## 8. Privacy and data handling

This section is the operator-facing summary. The technical version is in
[Architecture §10](ARCHITECTURE.md#10-data-privacy-and-security).

### 8.1 What stays on the device

| Data | Where it goes |
| --- | --- |
| Patient photographs | Decoded and processed in the tab. **Never uploaded.** |
| Face landmarks, reconstructed mesh, skin texture | Memory only. **Never uploaded.** |
| Consultation history, scenarios, live log | Browser memory while active; auto-saved to the local SQLite archive. |
| Archive | SQLite on the backend machine, mirrored to IndexedDB as an offline cache. Not synced to a cloud service, not encrypted by the app. |
| Report and log exports | Downloaded to your filesystem. |

### 8.2 What leaves the device

Only the **command text** (and up to four previous instruction summaries) is sent
to the parsing service when a command is interpreted. If the parsing service uses
its language-model path, that text goes to Google Gemini. Photographs, landmarks,
meshes, transcripts and archives are never included.

The parsing service holds no session and does not store command text itself, but a
reverse proxy or access log in front of it might. Do not deploy it behind one that
logs request bodies.

### 8.3 Practical rules

1. **Get consent** before loading a patient's photographs, and explain that they
   are processed locally and not saved.
2. **Clear the archive** according to your local policy. The app has no automatic
   retention or encryption.
3. **Treat exports as clinical notes.** A Markdown report, CSV, JSON or PDF may
   contain identifying free text from what was said.
4. **Do not use a shared device** for patient photographs unless you can clear the
   browser storage afterwards.
5. **Do not expose the parsing service** to an untrusted network. It has no
   authentication and permissive CORS by design for local use.

### 8.4 Browser storage

| Store | Used for | Cleared by |
| --- | --- | --- |
| Memory | The live workspace | Reload, new consultation |
| SQLite `backend/app/data/voicesurg.db` | Previous consultations (primary archive) | **Clear all**, deleting the database file |
| IndexedDB `voicesurg-history` | Offline cache/mirror of the archive | **Clear all**, browser site-data clearing |
| `localStorage` | Not used | — |

---

## 9. Photo personalisation and reconstruction

Photographs are optional. Without them the app uses the bundled realistic head.
With them, the head is shaped toward the patient's identity.

### 9.1 Opening the photo workflow

Press **View / Change Photos** in the 3D Simulation header. The photo manager
opens as an overlay.

### 9.2 Required and optional views

| Required | Optional |
| --- | --- |
| Front | Left three-quarter |
| Left profile | Right three-quarter |
| Right profile | Additional |

You need at least **two** views with a detected face to reconstruct. The three
required views give the best result; a missing required view produces a warning
and reduced accuracy, not necessarily a hard stop.

### 9.3 Photo requirements

| Rule | Value |
| --- | --- |
| Formats | PNG, JPEG, WebP |
| Maximum size | 12 MB |
| Minimum dimension | 256 px |
| Maximum dimension | 4096 px (larger triggers a warning) |
| Pose | Within roughly 50° of frontal for reliable detection |
| Expression | Neutral, eyes open, no occlusion |
| Lighting | Even; avoid strong side light and deep shadows |

### 9.4 Uploading

1. Click a view card and choose a file.
2. The card shows **Detecting landmarks...**, then either **478 landmarks** or
   **No face detected** with a reason.
3. If detection fails, the app retries with exposure normalisation and upscaling
   before giving up. Use **Retry** or replace the photo.
4. Repeat for the required views.

Each card shows its status, dimensions, validation warnings and actions. The
summary at the top counts uploaded views, usable views, total landmarks and
required views.

### 9.5 Running the reconstruction

1. Press **Start Reconstruction** (enabled when at least two views have
   landmarks).
2. Watch the progress stages: validating, fitting the shared shape, transferring
   onto the head, computing quality, finalising.
3. Review the preview: a rotatable reconstructed face, the neutral template
   outline, the quality score, the derived identity coefficients, the views used
   and any notes.
4. Press **Apply to Simulation**, or **Back to Photos** to adjust the set.

### 9.6 Reading the quality score

| Score | Band | Interpretation |
| --- | --- | --- |
| 80–100 % | Excellent | Strong agreement across views. |
| 60–79 % | Good | Usable; minor inconsistencies. |
| 40–59 % | Fair | Inspect the preview carefully. |
| 0–39 % | Poor | Retake the photos before relying on the shape. |

The card breaks the score into landmark coverage, view coverage, fitting accuracy,
symmetry, depth consistency, mean reprojection error (px) and identity deviation
(cm). A **Mean Reprojection** above 5 px or an **Identity Deviation** above 1.5 cm
is flagged.

Common warnings and what to do:

| Warning | Action |
| --- | --- |
| A view appears mirrored | Replace it with a correctly oriented photo. |
| A view matched poorly | Check lighting, occlusion and camera angle. |
| Photos do not agree on one shape | Make sure every photo is the same patient. |
| The set fits better when mirrored | Check that front and profiles show the same side. |
| Fit did not converge | Add a three-quarter view. |
| Quality is low | Retake with even light and a neutral expression. |

### 9.7 After applying

The head becomes the reconstructed patient mesh, and a photo-derived skin texture
is projected onto it. The workspace chip changes to **Reconstructed patient mesh**
and the face can still be modified with every parameter. If you later change or
remove a photo, a banner says the reconstruction is outdated; reconstruct again to
refresh it.

### 9.8 Privacy reminder

The photo manager, the detector and the reconstruction all run locally. No
photograph or landmark is uploaded, and none is stored after the tab closes. This
is a design property, not a setting you can accidentally turn off.

---

## 10. Limitations

Read these before using the output in a conversation.

### 10.1 Clinical and scientific

- **Not a medical device.** No regulatory clearance, no clinical validation.
- **Not calibrated.** `mm` and `degrees` are illustrative; the assumed 150 mm facial
  width is not measured.
- **Not predictive.** The head shows a proposed shape, not a surgical outcome.
- **No anatomy beneath the skin.** No bone, cartilage, muscle, fat or skin
  mechanics; no volume preservation or collision handling.
- **No measurement.** Landmarks and differences are visual aids, not measurements.
- **Single-photo depth is approximate.** Multi-view fitting improves it but still
  assumes a rigid, neutral pose.

### 10.2 Functional

- **11 registered parameters do not drive geometry.** They are visible but not
  wired; several alias onto core fields when used. See
  [Reference §5.1](REFERENCE.md#51-implementation-status).
- **Four parameters are explicitly unsupported:** nostril shape, nostril symmetry,
  dorsal septal deviation and left/right asymmetry.
- **Five backend regions are not in the target map:** nasal base, columella,
  septal region, left side, right side. Commands naming them return
  "Not supported".
- **English parsing.** Other recognition languages transcribe but are still parsed
  with English vocabulary.
- **Browser speech only.** Web Speech availability and accuracy vary by browser
  and platform.
- **One user, one tab.** No collaboration, accounts or sync.

### 10.3 Practical

- **Working sessions are memory-first.** The SQLite archive is auto-saved, but the live workspace itself is rebuilt from the archive on restore.
- **Archive is unencrypted and machine-local.** It is not a records system.
- **No automatic retention.** You must clear it; deleting the database file also removes it.
- **Photographs are not archived.**
- **Low-end devices** may render slowly during deformation or reconstruction.

These limitations are shown in the product itself — the header badge, the
workspace note and the photo privacy note — so they are visible during a
demonstration, not buried in this file.

---

## 11. Troubleshooting and recovery

### 11.1 Commands

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| **Parsing service: offline** | Backend not running or wrong port | Start uvicorn on `127.0.0.1:8000`; the probe recovers within 15 s. |
| "Could not extract any instruction" | No anatomical term or no magnitude | Rephrase with a region and a number, e.g. "raise the tip by 2 mm". |
| **Needs clarification** | Missing value/direction or out of range | Accept the suggestion, use a custom value, or rephrase. |
| **Not supported** | Region/parameter not modelled | Use a supported region ([Reference §5](REFERENCE.md#5-parameter-catalogue)). |
| **Invalid** | Wrong unit (e.g. inches) or negative number | Use `mm`, `cm` or `degrees`; state direction as a word. |
| **No change** | Magnitude was zero | Say a non-zero amount. |
| Change applied twice | Double click | The app guards duplicate proposal submissions; if history shows a duplicate, undo one. |

### 11.2 Voice

| Symptom | What to do |
| --- | --- |
| Microphone does not start | Check browser permission; use Chrome or Edge; use the typed field. |
| "Voice input unavailable" | The browser lacks Web Speech; type instead. |
| Wrong words transcribed | Speak one instruction at a time; reduce background noise; check the language setting. |
| Nothing happens after speaking | Check the service indicator; check the transcript log for an error. |

### 11.3 Photos and reconstruction

| Symptom | What to do |
| --- | --- |
| "No face detected" | Use a larger, brighter, more frontal photo; press Retry. |
| Start Reconstruction disabled | Fewer than two views have landmarks. |
| Reconstruction failed | Read the error, then **Try Again** or **Back to Photos**. |
| Preview says **Outdated** | Photos changed during the fit; run it again. |
| Model looks stretched | The photo set is inconsistent; replace the offending view and reconstruct. |
| Texture looks smeared at the sides | Profiles are missing or low quality; add them. |

### 11.4 Session and storage

| Symptom | What to do |
| --- | --- |
| Work disappeared after reload | Open **Previous consultations** and restore the auto-saved record. The live workspace is memory-only, but the archive is written while you work. |
| Archive is empty | The backend may be offline (the chip shows **Browser fallback**); start uvicorn on port 8000 and press **Refresh archive**. In private mode IndexedDB may also be blocked. |
| **Archive current** is disabled | Enter the patient name and surgeon in the **Patient & surgeon** panel and make at least one consultation change. Records without an owner are not written. |
| Panel says **Browser fallback** | The SQLite database is unreachable; records are kept in the browser cache until the backend returns. |
| "Could not generate the consultation summary" | Try again after a change; if it persists, export the live log instead. |
| Everything looks reset | Check **Reset simulation** was not pressed; undo history is not recoverable after a reset. |

### 11.5 Recovering a demonstration

If something goes wrong mid-demo:

1. Check the service indicator.
2. Switch to **Consultation** and type one simple command.
3. If parsing is down, use **Simulation Parameters** — sliders need no backend.
4. If the head looks wrong, press **Reset simulation**, then **Reset view**.
5. If photos caused the problem, open **View / Change Photos** and remove them;
   the bundled head returns.

---

## 12. Accessibility

- The main flow is keyboard-operable: tab to the microphone button, the typed
  field, instruction cards, sliders and dialog buttons.
- **ConfirmDialog** traps focus, has a labelled title and closes on Escape.
- Status messages use `role="status"`; the live transcript region is `aria-live`.
- Sliders carry `aria-label` and `aria-valuetext` (for example "+2 mm"), so screen
  readers announce the value and unit.
- Buttons without visible text carry `aria-label`.
- The photo manager and reconstruction overlays are visually modal but **do not**
  currently trap focus or expose full dialog semantics. Until that is fixed, use
  the visible Close/Cancel buttons and avoid tabbing behind the overlay.
- The 3D canvas is not keyboard-navigable beyond the toolbar; the numeric
  parameters provide the accessible equivalent of the visual change.

If you need a fully accessible workflow today, use the **Simulation Parameters**
and **Session History** panels, which expose the same state as text and standard
form controls.
