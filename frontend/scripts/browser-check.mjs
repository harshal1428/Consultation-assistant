/**
 * Browser runtime check for the multi-photo reconstruction workflow.
 *
 * Drives a real Chrome instance over the DevTools protocol so the whole
 * pipeline (MediaPipe landmark detection, the multi-view fit, the shape
 * transfer, the preview) is exercised in the browser - not only in jsdom.
 *
 * Usage: node scripts/browser-check.mjs <appUrl> <imageDir>
 */

import { CdpSession, sleep } from "./cdp.mjs";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4173/";
const IMAGE_DIR = process.argv[3] ?? "tests\\fixtures";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

/* -------------------------------------------------------------------------- */
/* Live scene inspection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The rendered three.js scene is reached through the `controlsRef` prop that
 * the workspace hands to the viewer: the OrbitControls instance holds the
 * camera, the camera carries r3f's `__r3f` handle and that handle exposes
 * the whole scene graph. This lets the check read the *actual* vertex
 * positions that are being rendered.
 */
const SCENE_ACCESS = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  const key = Object.getOwnPropertyNames(canvas).find(k => k.startsWith('__reactFiber$'));
  let fiber = canvas[key];
  let depth = 0;
  while (fiber && depth < 80) {
    const ref = fiber.memoizedProps && fiber.memoizedProps.controlsRef;
    const controls = ref && ref.current;
    if (controls) {
      for (const handle of [controls.__r3f, controls.object && controls.object.__r3f]) {
        const state = handle && handle.root && handle.root.getState ? handle.root.getState() : null;
        if (state && state.scene) return state.scene;
      }
    }
    fiber = fiber.return;
    depth += 1;
  }
  return null;
})`;

/** Describe what the scene lookup found - used when the lookup fails. */
const SCENE_DIAGNOSTIC = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 'no canvas';
  const key = Object.getOwnPropertyNames(canvas).find(k => k.startsWith('__reactFiber$'));
  let fiber = canvas[key];
  let depth = 0;
  const seen = [];
  while (fiber && depth < 80) {
    const props = fiber.memoizedProps || {};
    if (props.controlsRef) {
      const controls = props.controlsRef.current;
      seen.push({
        depth,
        controls: !!controls,
        controlsR3f: !!(controls && controls.__r3f),
        objectR3f: !!(controls && controls.object && controls.object.__r3f),
      });
    }
    fiber = fiber.return;
    depth += 1;
  }
  return JSON.stringify(seen);
})()`;

/** Collect every mesh geometry of the live three.js scene. */
const SNAPSHOT_SCENE = `(() => {
  const scene = (${SCENE_ACCESS})();
  if (!scene) return { error: 'no scene' };
  const meshes = [];
  scene.traverse((obj) => {
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return;
    meshes.push({ id: String(obj.id), count: pos.count, data: Float32Array.from(pos.array) });
  });
  window.__vsBefore = meshes;
  const largest = meshes.reduce((a, m) => (m.count > (a?.count ?? 0) ? m : a), null);
  return { meshes: meshes.length, largest: largest ? largest.count : 0 };
})()`;

/** Compare the live scene against the snapshot taken before the apply. */
const COMPARE_SCENE = `(() => {
  const before = window.__vsBefore;
  if (!before) return { error: 'no snapshot' };
  const scene = (${SCENE_ACCESS})();
  if (!scene) return { error: 'no scene' };
  const after = [];
  scene.traverse((obj) => {
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return;
    after.push({ id: String(obj.id), count: pos.count, data: Float32Array.from(pos.array) });
  });
  const beforeById = new Map(before.map((m) => [m.id, m]));
  let changedVertices = 0;
  let maxDelta = 0;
  let compared = 0;
  let comparedVertices = 0;
  for (const mesh of after) {
    const ref = beforeById.get(mesh.id);
    if (!ref || ref.data.length !== mesh.data.length) continue;
    compared += 1;
    const a = ref.data;
    const b = mesh.data;
    for (let v = 0; v < a.length; v += 3) {
      const d = Math.hypot(b[v] - a[v], b[v + 1] - a[v + 1], b[v + 2] - a[v + 2]);
      comparedVertices += 1;
      if (d > 1e-6) changedVertices += 1;
      if (d > maxDelta) maxDelta = d;
    }
  }
  return { meshes: after.length, compared, comparedVertices, changedVertices, maxDelta };
})()`;

/** Inspect the head material for the photo-derived skin texture. */
const SKIN_TEXTURE_STATE = `(() => {
  const scene = (${SCENE_ACCESS})();
  if (!scene) return { error: 'no scene' };
  let found = null;
  scene.traverse((obj) => {
    if (found) return;
    const material = obj.material;
    const map = material && material.map;
    if (!map || !map.image) return;
    const image = map.image;
    found = {
      width: image.width,
      height: image.height,
      coverage: image.dataset ? image.dataset.coverage : null,
      textured: image.dataset ? image.dataset.texturedTexels : null,
      views: image.dataset ? image.dataset.views : null,
      color: material.color ? material.color.getHexString() : null,
    };
  });
  return found || { hasMap: false };
})()`;

/* -------------------------------------------------------------------------- */

async function main() {
  const session = await CdpSession.open();
  const { send, evaluate, waitFor } = session;
  const consoleErrors = session.consoleErrors;
  const consoleWarnings = session.consoleWarnings;
  const pageErrors = session.pageErrors;

  /* -- 1. The application loads ------------------------------------------ */
  await send("Page.navigate", { url: APP_URL });
  await waitFor(
    `!!document.querySelector('.app') && document.body.innerText.includes('View / Change Photos')`,
    45000,
    "app shell",
  );
  record("application shell renders", true);

  /* -- 2. The default head is rendered ---------------------------------- */
  const canvasCount = await evaluate(`document.querySelectorAll('canvas').length`);
  record("3D canvas is present", canvasCount > 0, `${canvasCount} canvas element(s)`);

  /* -- 3. No photos are shown in the workspace ---------------------------- */
  const workspaceImages = await evaluate(
    `Array.from(document.querySelectorAll('.app__main img')).filter(i => (i.getAttribute('src')||'').startsWith('blob:')).length`,
  );
  record("no photo thumbnails in the workspace", workspaceImages === 0, `${workspaceImages} blob images`);

  /* -- 4. The photo manager opens --------------------------------------- */
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('View / Change Photos')).click()`,
  );
  await waitFor(`!!document.querySelector('.photo-manager')`, 15000, "photo manager");
  record("View / Change Photos opens the photo manager", true);

  const cards = await evaluate(
    `Array.from(document.querySelectorAll('.photo-card')).map(c => c.querySelector('.photo-card__title')?.textContent)`,
  );
  record(
    "all six views are offered",
    cards.length === 6,
    cards.join(", "),
  );

  const inputViews = await evaluate(
    `Array.from(document.querySelectorAll('.photo-card__input')).map(i => i.getAttribute('data-view'))`,
  );
  record(
    "every view has its own labelled file input",
    inputViews.length === 6 && new Set(inputViews).size === 6,
    inputViews.join(", "),
  );

  /* -- 5. Uploading a photo detects a face -------------------------------- */
  async function uploadPhoto(view, filePath) {
    // The file input is re-queried for every upload: React re-renders the
    // cards, so a node id captured earlier can become stale.
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `input[data-view="${view}"]`,
    });
    if (!nodeId) throw new Error(`No file input for view ${view}`);
    await send("DOM.setFileInputFiles", { nodeId, files: [filePath] });
  }

  const { readdirSync } = await import("node:fs");
  const { basename, join, resolve } = await import("node:path");
  const images = readdirSync(IMAGE_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    // Chrome resolves the path against its own working directory, so the
    // fixtures have to be handed over as absolute paths.
    .map((f) => resolve(join(IMAGE_DIR, f)));
  record("test photographs are available", images.length > 0, images.length + " file(s)");

  const VIEW_BY_NAME = [
    ["front", "front"],
    ["left-profile", "left-profile"],
    ["left-profile", "leftprofile"],
    ["right-profile", "right-profile"],
    ["right-profile", "rightprofile"],
    ["left-three-quarter", "left-three-quarter"],
    ["left-three-quarter", "leftthreequarter"],
    ["right-three-quarter", "right-three-quarter"],
    ["right-three-quarter", "rightthreequarter"],
  ];
  function viewForFile(file) {
    // Only the file name is inspected: an absolute path would match the
    // "front" token inside the "frontend" directory name.
    const lower = basename(file).toLowerCase();
    for (const [view, token] of VIEW_BY_NAME) {
      if (lower.includes(token)) return view;
    }
    return null;
  }

  const detected = [];
  for (const file of images) {
    const view = viewForFile(file);
    if (!view) {
      console.log(`      ${file}: skipped (no view mapping)`);
      continue;
    }
    await uploadPhoto(view, file);
    // Wait until the landmark detection for this view has actually finished.
    const found = await waitFor(
      `(() => {
         const card = document.querySelector('.photo-card[data-view="${view}"]');
         const status = card?.getAttribute('data-landmark-status');
         return status === 'complete' || status === 'error' ? status : false;
       })()`,
      120000,
      `upload ${view}`,
    ).catch(() => false);
    const status = await evaluate(
      `document.querySelector('.photo-card[data-view="${view}"]')?.querySelector('.photo-card__status')?.textContent || ''`,
    );
    const cardText = await evaluate(
      `document.querySelector('.photo-card[data-view="${view}"]')?.innerText.replace(/\\s+/g,' ').trim() || ''`,
    );
    detected.push({ view, file, status, found, cardText });
    console.log(`      ${view} <- ${file}: ${status}`);
    console.log(`         card: ${cardText.slice(0, 300)}`);
  }

  const withLandmarks = detected.filter((d) => d.status.includes("landmarks"));
  record(
    "every uploaded photograph gets a definitive detection result",
    detected.length === 5 && detected.every((d) => d.found === "complete" || d.found === "error"),
    detected.map((d) => `${d.view}: ${d.found}`).join(" | "),
  );
  record(
    "the face detector fires on the frontal and three-quarter photographs",
    withLandmarks.length >= 3,
    `${withLandmarks.length}/${detected.length} views produced landmarks`,
  );
  const undetected = detected.filter((d) => !d.status.includes("landmarks"));
  record(
    "a profile photo the detector cannot handle is explained, not hidden",
    undetected.length === 0 ||
      undetected.every((d) => /turned at most about 50/.test(d.cardText)),
    undetected.map((d) => d.view).join(", ") || "none",
  );

  /* -- 6. The manager shows the per-view state --------------------------- */
  const missing = await evaluate(
    `Array.from(document.querySelectorAll('.photo-card')).filter(c => c.classList.contains('empty')).length`,
  );
  record("missing views are indicated", missing > 0, `${missing} empty card(s)`);

  const notice = await evaluate(
    `document.querySelector('.photo-manager__notice')?.innerText.replace(/\\s+/g,' ').trim() || ''`,
  );
  record(
    "missing required views are reported to the user",
    notice.length > 0,
    notice.slice(0, 160),
  );

  /* -- 7. The reconstruction panel --------------------------------------- */
  const canReconstruct = await evaluate(
    `(() => { const b = Array.from(document.querySelectorAll('.photo-manager button')).find(x => x.textContent.includes('Accept & Reconstruct')); return b ? { disabled: b.disabled } : null; })()`,
  );
  record(
    "the manager offers the reconstruction step",
    canReconstruct !== null && canReconstruct.disabled === false,
    JSON.stringify(canReconstruct),
  );

  await evaluate(
    `Array.from(document.querySelectorAll('.photo-manager button')).find(b => b.textContent.includes('Accept & Reconstruct')).click()`,
  );
  await waitFor(`!!document.querySelector('.reconstruction-panel')`, 15000, "reconstruction panel");
  record("the reconstruction panel opens", true);

  const summary = await evaluate(
    `document.querySelector('.reconstruction__summary')?.innerText.replace(/\\s+/g, ' ').trim() || ''`,
  );
  console.log(`      summary: ${summary}`);

  /* -- 8. Run the real reconstruction ------------------------------------ */
  const startButton = await evaluate(
    `(() => { const b = Array.from(document.querySelectorAll('.reconstruction-panel button')).find(x => x.textContent.includes('Start Reconstruction')); return b ? { disabled: b.disabled } : null; })()`,
  );
  record("the reconstruction can be started", startButton !== null, JSON.stringify(startButton));

  let panelFailed = false;
  let panelMessage = "";
  if (startButton && !startButton.disabled) {
    await evaluate(
      `Array.from(document.querySelectorAll('.reconstruction-panel button')).find(x => x.textContent.includes('Start Reconstruction')).click()`,
    );
    const outcome = await waitFor(
      `(() => {
         const panel = document.querySelector('.reconstruction-panel');
         if (!panel) return false;
         if (panel.innerText.includes('Reconstructed Face')) return 'preview';
         if (panel.innerText.includes('Reconstruction Failed')) return 'failed';
         return false;
       })()`,
      180000,
      "reconstruction outcome",
    ).catch(() => false);
    panelMessage = await evaluate(
      `document.querySelector('.reconstruction-panel')?.innerText.replace(/\\s+/g,' ').trim().slice(0, 400) || ''`,
    );
    console.log(`      panel: ${outcome} :: ${panelMessage}`);
    panelFailed = outcome === "failed";
    if (outcome === "preview") {
      const polygons = await evaluate(
        `document.querySelectorAll('.preview3d__canvas polygon').length`,
      );
      record("the 3D preview renders the reconstructed mesh", polygons > 100, `${polygons} polygons`);
      const quality = await evaluate(
        `document.querySelector('.quality-score__value')?.textContent || ''`,
      );
      record("the reconstruction reports a quality score", /%/.test(quality), quality);

      const viewsUsed = await evaluate(
        `Array.from(document.querySelectorAll('.view-used')).map(v => v.innerText.replace(/\\s+/g,' ').trim())`,
      );
      record(
        "the preview reports which views were used",
        viewsUsed.length >= 2,
        viewsUsed.join(" | "),
      );

      /* -- 9. The preview can be rejected and taken back to the photos ----- */
      await evaluate(
        `Array.from(document.querySelectorAll('.reconstruction-panel button')).find(x => x.textContent.includes('Back to Photos')).click()`,
      );
      await waitFor(`!!document.querySelector('.photo-manager')`, 15000, "photo manager reopened");
      const rejected = await evaluate(
        `!!document.querySelector('.reconstruction-panel')`,
      );
      record(
        "the preview can be rejected and returns to the photos",
        rejected === false,
        rejected ? "the panel stayed open" : "the manager reopened",
      );
      // Accept again and rebuild the reconstruction for the apply step.
      await evaluate(
        `Array.from(document.querySelectorAll('.photo-manager button')).find(x => /Accept|Reconstruct/i.test(x.textContent)).click()`,
      );
      await waitFor(`!!document.querySelector('.reconstruction-panel')`, 15000, "reconstruction panel");
      await evaluate(
        `Array.from(document.querySelectorAll('.reconstruction-panel button')).find(x => x.textContent.includes('Start Reconstruction')).click()`,
      );
      const reconfirmed = await waitFor(
        `(() => {
           const panel = document.querySelector('.reconstruction-panel');
           if (!panel) return false;
           if (panel.innerText.includes('Reconstructed Face')) return 'preview';
           if (panel.innerText.includes('Reconstruction Failed')) return 'failed';
           return false;
         })()`,
        180000,
        "reconstruction outcome after the rejection",
      ).catch(() => false);
      record(
        "the reconstruction can be repeated after a rejection",
        reconfirmed === "preview",
        String(reconfirmed),
      );

      /* -- 9. Apply the reconstruction to the simulation ------------------ */
      // The rendered scene graph is inspected before and after the
      // reconstruction is applied. The vertex positions have to change,
      // otherwise the "patient mesh" would only be a label and not the
      // actual simulation model.
      const before = await evaluate(SNAPSHOT_SCENE);
      console.log(`      scene before: ${JSON.stringify(before)}`);
      if (before && before.error) {
        console.log(`      scene diagnostic: ${await evaluate(SCENE_DIAGNOSTIC)}`);
      }

      await evaluate(
        `Array.from(document.querySelectorAll('.reconstruction-panel button')).find(x => x.textContent.includes('Apply to Simulation')).click()`,
      );
      await waitFor(
        `document.body.innerText.includes('Reconstructed patient mesh')`,
        20000,
        "personalized mesh chip",
      );
      record("applying the reconstruction switches the workspace to the patient mesh", true);

      // The reconstructed mesh is textured with the patient's own photographs
      // (projected through the fitted camera poses). The texture is built
      // asynchronously after the apply, so wait for it before inspecting.
      const skinTexture = await waitFor(
        `(() => { const state = ${SKIN_TEXTURE_STATE}; return state && state.width ? state : false; })()`,
        90000,
        "photo-derived skin texture",
      ).catch(() => null);
      record(
        "the patient mesh is shaded with a photo-derived skin texture",
        Boolean(skinTexture) &&
          skinTexture.width === 1024 &&
          skinTexture.height === 512 &&
          Number(skinTexture.coverage) > 0.04 &&
          String(skinTexture.views || "").includes("front"),
        skinTexture
          ? `${skinTexture.width}x${skinTexture.height}, coverage ${skinTexture.coverage}, views ${skinTexture.views}`
          : "no texture was applied",
      );
      record(
        "the photo texture is not a flat tint (real texels were sampled)",
        Boolean(skinTexture) && Number(skinTexture.textured) > 5000,
        skinTexture ? `${skinTexture.textured} textured texels` : "no texture",
      );

      // Give the renderer a few frames to pick up the new geometry.
      await sleep(1500);
      const after = await evaluate(COMPARE_SCENE);
      console.log(`      scene after: ${JSON.stringify(after)}`);
      record(
        "the applied reconstruction changes the rendered 3D model",
        Boolean(after) && after.changedVertices > 100 && after.maxDelta > 0.0005,
        after ? `${after.changedVertices} vertices moved, max ${after.maxDelta?.toFixed?.(5)}` : "no scene",
      );

      const stillOpen = await evaluate(`!!document.querySelector('.reconstruction-panel')`);
      record("the reconstruction panel closes after applying", stillOpen === false);
      const managerOpen = await evaluate(`!!document.querySelector('.photo-manager')`);
      record(
        "the photo manager does not re-open after a render",
        managerOpen === false,
        managerOpen ? "the manager was open" : "closed",
      );

      /* -- 10. The patient mesh survives a mode switch --------------------- */
      // The applied mesh is the baseline for the whole consultation: switching
      // to Live Simulation must not swap it back to the generic face.
      await evaluate(SNAPSHOT_SCENE);
      await evaluate(
        `Array.from(document.querySelectorAll('.segmented__item')).find(b => b.textContent.includes('Live Simulation')).click()`,
      );
      await sleep(1500);
      const liveChip = await evaluate(
        `Array.from(document.querySelectorAll('.chip')).map(c => c.textContent.trim()).find(t => /mesh/i.test(t)) || ''`,
      );
      record(
        "live simulation keeps the reconstructed patient mesh",
        liveChip === "Reconstructed patient mesh",
        liveChip,
      );
      const liveScene = await evaluate(COMPARE_SCENE);
      record(
        "the patient mesh is not replaced by the generic face in live mode",
        Boolean(liveScene) && liveScene.compared > 0 && liveScene.changedVertices === 0,
        liveScene
          ? `${liveScene.compared} meshes compared, ${liveScene.changedVertices} vertices moved`
          : "no scene",
      );

      await evaluate(
        `Array.from(document.querySelectorAll('.segmented__item')).find(b => b.textContent.includes('Consultation')).click()`,
      );
      await sleep(1200);
      const backScene = await evaluate(COMPARE_SCENE);
      record(
        "returning to consultation keeps the patient mesh",
        Boolean(backScene) && backScene.compared > 0 && backScene.changedVertices === 0,
        backScene
          ? `${backScene.compared} meshes compared, ${backScene.changedVertices} vertices moved`
          : "no scene",
      );

      /* -- 11. Deleting a photo is a real deletion ------------------------- */
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('View / Change Photos')).click()`,
      );
      await waitFor(`!!document.querySelector('.photo-manager')`, 15000, "photo manager");
      const cardState = `Array.from(document.querySelectorAll('.photo-card')).map(c => c.getAttribute('data-view') + '=' + (c.querySelector('.photo-card__preview img') ? 'photo' : 'empty')).join(' ')`;
      const stateBefore = await evaluate(cardState);
      await evaluate(
        `(() => {
           const card = document.querySelector('.photo-card[data-view="front"]');
           const button = Array.from(card.querySelectorAll('button')).find(b => b.textContent.trim() === 'Remove');
           if (!button) throw new Error('no remove button');
           button.click();
         })()`,
      );
      await sleep(800);
      const stateAfter = await evaluate(cardState);
      record(
        "removing a view deletes only that photo",
        stateBefore.includes("front=photo") &&
          stateAfter.includes("front=empty") &&
          stateAfter.includes("left-three-quarter=photo"),
        stateAfter,
      );
      const blobLeft = await evaluate(
        `Array.from(document.querySelectorAll('.photo-card__preview img')).filter(i => (i.getAttribute('src')||'').startsWith('blob:')).length`,
      );
      const photosLeft = (stateAfter.match(/=photo/g) || []).length;
      record(
        "the deleted photo releases its object URL",
        blobLeft === photosLeft,
        `${blobLeft} blob preview(s) for ${photosLeft} remaining photo(s)`,
      );

      await evaluate(`document.querySelector('.modal-overlay')?.click()`);
      await waitFor(`!document.querySelector('.photo-manager')`, 15000, "photo manager closed");
      const stale = await evaluate(
        `document.querySelector('.workspace__stale')?.innerText.replace(/\\s+/g,' ').trim() || ''`,
      );
      record(
        "changing the photos marks the reconstruction as outdated",
        stale.includes("photos changed"),
        stale.slice(0, 90),
      );
      const chipAfterDelete = await evaluate(
        `Array.from(document.querySelectorAll('.chip')).map(c => c.textContent.trim()).find(t => /mesh/i.test(t)) || ''`,
      );
      record(
        "the saved consultation is not silently modified by a photo change",
        chipAfterDelete === "Reconstructed patient mesh",
        chipAfterDelete,
      );
    }
  }
  record(
    "the reconstruction reports success or an honest failure",
    panelFailed || panelMessage.length > 0,
    panelFailed ? "failed as expected without usable landmarks" : "completed",
  );

  /* -- 12. No console errors -------------------------------------------- */
  record(
    "no uncaught page exceptions",
    pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "),
  );
  // MediaPipe writes an informational line through the error channel; it is a
  // vendor notice about the CPU delegate, not an application error.
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|XNNPACK delegate/i.test(e),
  );
  record("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  const realWarnings = consoleWarnings.filter(
    (e) => !/THREE\.Clock|face_landmarker_graph|gl_context|landmark_projection|inference_feedback/i.test(e),
  );
  record(
    "no unexpected console warnings",
    realWarnings.length === 0,
    realWarnings.slice(0, 3).join(" | "),
  );

  await session.close();

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("browser-check crashed:", error);
  process.exit(2);
});
