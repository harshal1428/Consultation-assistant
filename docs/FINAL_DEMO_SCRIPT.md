# VoiceSurg 3D — Final Demo Script (Phase 8)

**Audience:** reviewers / stakeholders.
**Goal:** show a complete, honest workflow in ~8 minutes: natural-language command
→ safe validation → explicit confirmation → deterministic 3D change → history,
scenarios, comparison and an exported summary.
**Tone:** this is a **simulation prototype**, not a clinical tool. Say so up front
and again when exporting.

---

## 0. Pre-flight (30 s, before the audience arrives)

1. Start the backend (root):
   ```powershell
   .\.venv\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8000
   ```
2. Start the built frontend (new terminal):
   ```powershell
   cd frontend
   npm run build
   npx vite preview --host 127.0.0.1 --port 4173
   ```
3. Open **http://127.0.0.1:4173/** in Chrome or Edge.
4. Confirm the header shows **Parsing service: online** (green dot). If it says
   *offline*, the backend isn't up — restart step 1.

**One-sentence framing:** *"This turns a spoken or typed instruction into a
reviewable, confirmed change on a stylized 3D face. It never applies anything until
you explicitly confirm."*

> Note: you can run everything from the **typed command** field. Voice is a bonus
> (Chrome/Edge) and uses the exact same pipeline.

---

## 1. Golden path — one safe change (1 min)

1. In **Surgeon Consultation → Type a command**, type:
   > **Reduce the nasal bridge height by 2 millimetres** → Send.
2. Point out: a **Proposed change** card appears with *Region · Nasal Bridge*,
   *Parameter · Height*, **−2 mm**, a confidence chip and the parser it used
   (`language model` normally, `rules` if the model was slow — both are fine).
   **Nothing has changed yet.**
3. Click **Confirm & simulate**.
   - The 3D bridge dips slightly, the **Session History** shows
   *Nasal Bridge · Height · −2 mm*, the transcript row flips to **Confirmed**, and
   the timeline records *Proposal confirmed*.
5. Point out the 3D toolbar: **Original / Simulated / Compare**, plus Landmarks,
   Wireframe, Heatmap and Reset view.

---

## 1b. Compound command (30 s)

Type: *"Reduce the nasal bridge height by 2 mm and increase the tip projection by
3 mm."* → a **Change set** with two cards → **Confirm & simulate (2)** → both sliders
move, two history rows.

---

## 1. Safety behaviours (2 min) — the strongest part of the story

Type each (or read them aloud); note that **nothing moves**.

| Say / type | What the app does | Point to |
|---|---|---|
| "Make my nose better" | **Invalid** — no supported region; confirm disabled | honest refusal |
| "Make the nasal bridge higher" | **Needs clarification** — value missing; offers **1 mm / 2 mm / Custom** | never invents a number |
| "Reduce the nasal bridge height by 2 inches" | **Not supported** — use millimetres | unit guard |
| "Reduce the nasal bridge height by 100 millimetres" | **Needs clarification** — **Accept adjusted 10 mm** | out-of-range is proposed, not silently clamped |
| "Do not reduce the nasal bridge" | **No change** (negated) | negation guard |
| "Make the forehead bigger" | **Not supported** — lists supported regions | scope boundary |
| "Widen the nasal bridge by 2 mm and make the tip bigger" | 1 ready + 1 **needs clarification**; full-set confirm disabled, **Apply only valid (1)** offered | change sets apply in full, or deliberately as a subset |

Then click **1 mm** on the clarification card (or **Accept adjusted 10 mm**) to show
an ambiguous instruction becoming applicable through an explicit user choice — the
model is never allowed to guess.

---

## 2. Multi-region + manual control (1 min)

In **Simulation Parameters**, click a region — Nose, Lips, Chin, Jawline or
Cheeks — to expand it, then drag its sliders (e.g. **Upper-lip projection**,
**Chin projection**, **Jawline definition**, **Cheek fullness**). The panel shows
the parts first; a region's controls appear only after you select it, and a small
badge counts the parameters that changed in each region. Note: each region moves
independently and each edit appears in the timeline; the mesh is recomputed from
the baseline with no drift.

---

## 3. History, undo and reset (30 s)

- In **Session History**, click the **undo** icon on a row → that change is removed
  and the face recomputes; a **Change undone** event is logged.
- **Reset** (history panel or header) → confirm **Reset to baseline** → all sliders
  return to 0. The transcript, timeline and scenarios are kept (by design). Any
  proposal still awaiting review is cancelled.

---

## 4. Scenarios, compare and export (1.5 min)

1. Set a look, then save it as a scenario (e.g. **"Conservative"**).
2. Change a couple of sliders, save a second scenario (e.g. **"Projected tip"**).
3. Click **Load** on a scenario → the working state snaps to it.
4. Switch the 3D view to **Compare**; choose **Original (baseline)** on the left and
   a saved scenario on the right → two faces side by side with a **parameter
   difference** table.
5. Click **Save report** → a Markdown summary downloads. Open it and read the
   **Limitations** section aloud.

---

## 5. Voice (optional, 30 s) — if Chrome/Edge and a microphone

Enable the mic, say *"Reduce the bridge by 2 millimetres"*, watch the live
transcript, then **Confirm**. If the browser doesn't expose the Web Speech API, the
UI says so and the typed field is used instead — same pipeline.

---

## 5b. New capabilities (1 min) — reference, modes, on-device archive

1. **Reference portrait:** open the **Reference portrait** panel beside the face.
   Thumbnails show the bundled portraits; click one to show it next to the 3D face,
   or **Upload** your own image (PNG/JPEG/WebP). Point out the privacy note: images
   stay on the device — the browser makes no external requests. Click **Stop
   comparing** to close it.
2. **Modes:** in the header switch **Live Simulation ↔ Consultation**. Live hides
   the command/review surfaces for fast slider work; Consultation restores them. An
   in-progress proposal is never lost when switching.
3. **Saved consultations (on-device):** click **Archive current** → the consultation
   appears under **Saved consultations** with its timestamp and change count.
   **Reload the page** → the entry is still there (IndexedDB, this device only).
   **Restore** reloads that state; **Delete** / **Clear all** remove it.

---

## 6. Close the session (10 s)

- **End consultation** → the session is marked *Ended*, inputs disable, the timeline
  keeps everything.
- **New consultation** → confirm *Discard and start new* → a fresh in-memory session.

**Closing line:** *"The live session is in-memory and provisional; the only thing
that persists is an optional archive stored locally on this device — no cloud, no
patient data, no clinical claim. It demonstrates the safe interaction contract:
parse, validate, review, confirm."*

---

## Appendix — if something looks slow

- **A card says "Parsed by rules" instead of "language model".** The model was slow,
  so the deterministic parser answered under a hard 12 s ceiling. This is intended;
  continue the demo — the result is still correct. (You can optionally note:
  *"it degrades to the rules engine rather than hanging."*)
- **"Parsing service: offline"** → the backend isn't running; restart it (step 0.1).
- **A red "Parsing service" error** → the backend was unreachable or too slow; click
  dismiss and retry, or continue with manual sliders.
- **No microphone option** → expected on browsers without the Web Speech API; use
  the typed field.

**Total runtime:** ~8 minutes (≈4 for the golden path + safety, ≈4 for scenarios,
compare and export).
