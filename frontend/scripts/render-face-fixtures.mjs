/**
 * Renders test photographs of the canonical face model.
 *
 * These renders are *test fixtures* for the reconstruction pipeline: they are
 * produced from the licensed canonical asset, they contain a real face in a
 * real pose, and they let the whole multi-view fit be exercised end to end
 * without shipping patient photographs.
 *
 * The canonical asset is an open face *surface*; a photograph of a head also
 * contains a cranium, hair, ears, a neck and shoulders. Those parts are
 * approximated with simple primitives so the rendered images have a head
 * silhouette that a face detector can find in every pose - including the
 * profile poses, where the face surface alone would collapse to a sliver.
 *
 * Usage: node scripts/render-face-fixtures.mjs <outputDir> [--ascii]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const OUT_DIR = process.argv[2] ?? join(process.cwd(), "..", "ss", "fixtures");
const OBJ = join(process.cwd(), "public", "models", "canonical_face_model.obj");

/* -------------------------------------------------------------------------- */
/* OBJ parsing                                                                 */
/* -------------------------------------------------------------------------- */

const text = readFileSync(OBJ, "utf8");
const positions = [];
const indices = [];
for (const rawLine of text.split("\n")) {
  const line = rawLine.trim();
  if (line.startsWith("v ")) {
    const parts = line.split(/\s+/);
    positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  } else if (line.startsWith("f ")) {
    const face = line
      .split(/\s+/)
      .slice(1)
      .map((p) => Number(p.split("/")[0]) - 1);
    for (let i = 1; i + 1 < face.length; i += 1) {
      indices.push(face[0], face[i], face[i + 1]);
    }
  }
}
const vertexCount = positions.length / 3;
const triangles = indices.length / 3;

/* -------------------------------------------------------------------------- */
/* PNG writer                                                                  */
/* -------------------------------------------------------------------------- */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function writePng(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

/* -------------------------------------------------------------------------- */
/* Canvas primitives                                                           */
/* -------------------------------------------------------------------------- */

function blend(rgba, o, colour, alpha) {
  rgba[o] = Math.round(rgba[o] * (1 - alpha) + colour[0] * alpha);
  rgba[o + 1] = Math.round(rgba[o + 1] * (1 - alpha) + colour[1] * alpha);
  rgba[o + 2] = Math.round(rgba[o + 2] * (1 - alpha) + colour[2] * alpha);
}

/** Scanline triangle fill. */
function fillTriangle(rgba, width, height, x0, y0, x1, y1, x2, y2, colour) {
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    const xs = [];
    for (const [ax, ay, bx, by] of [
      [x0, y0, x1, y1],
      [x1, y1, x2, y2],
      [x2, y2, x0, y0],
    ]) {
      if (ay === by) continue;
      const t = (py - ay) / (by - ay);
      if (t < 0 || t > 1) continue;
      xs.push(ax + t * (bx - ax));
    }
    if (xs.length < 2) continue;
    const xa = Math.max(0, Math.ceil(Math.min(...xs) - 0.5));
    const xb = Math.min(width - 1, Math.floor(Math.max(...xs) - 0.5));
    for (let x = xa; x <= xb; x += 1) {
      const px = x + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      blend(rgba, (y * width + x) * 4, colour, 1);
    }
  }
}

function drawDisc(rgba, width, height, cx, cy, rx, ry, colour, alpha = 1) {
  const minX = Math.max(0, Math.floor(cx - rx));
  const maxX = Math.min(width - 1, Math.ceil(cx + rx));
  const minY = Math.max(0, Math.floor(cy - ry));
  const maxY = Math.min(height - 1, Math.ceil(cy + ry));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      blend(rgba, (y * width + x) * 4, colour, alpha);
    }
  }
}

function drawPolyline(rgba, width, height, points, thickness, colour) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      drawDisc(rgba, width, height, x0 + t * (x1 - x0), y0 + t * (y1 - y0), thickness, thickness, colour, 1);
    }
  }
}

function drawPolygon(rgba, width, height, points, colour, alpha = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y += 1) {
    const py = y + 0.5;
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (ay === by) continue;
      const t = (py - ay) / (by - ay);
      if (t < 0 || t > 1) continue;
      xs.push(ax + t * (bx - ax));
    }
    if (xs.length < 2) continue;
    const xa = Math.max(0, Math.ceil(Math.min(...xs) - 0.5));
    const xb = Math.min(width - 1, Math.floor(Math.max(...xs) - 0.5));
    for (let x = xa; x <= xb; x += 1) {
      blend(rgba, (y * width + x) * 4, colour, alpha);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Head model (approximate solids behind the face surface)                      */
/* -------------------------------------------------------------------------- */

const SKIN = [222, 184, 156];
const HAIR = [58, 42, 36];
const CLOTH = [58, 62, 74];

const CRANIUM = { centre: [0, 1.1, -3.3], radius: 8.0 };
const HAIR_CAP = { centre: [0, 2.5, -3.9], radius: 8.5 };
const EARS = [
  { centre: [7.5, -1.0, -2.4], radius: [0.8, 1.9, 1.5] },
  { centre: [-7.5, -1.0, -2.4], radius: [0.8, 1.9, 1.5] },
];

/* -------------------------------------------------------------------------- */
/* Facial features (the face detector needs eyes, brows, lips and nostrils)   */
/* -------------------------------------------------------------------------- */

const FEATURES = {
  rightBrow: [46, 70, 63, 105, 66, 107],
  leftBrow: [276, 336, 296, 334, 293, 300],
  rightEye: { outer: 33, inner: 133, upper: 159, lower: 145 },
  leftEye: { outer: 263, inner: 362, upper: 386, lower: 374 },
  upperLip: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  lowerLip: [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  mouthLine: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  nostril: [205, 425],
};

/**
 * The face surface collapses to a sliver when it is seen edge-on, so the
 * eyeballs and the lips are added as solids. Without them a profile render
 * has no eye and no mouth volume and no face detector will find a face in it.
 */
function centroid(indices) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of indices) {
    x += positions[index * 3];
    y += positions[index * 3 + 1];
    z += positions[index * 3 + 2];
  }
  const n = indices.length;
  return [x / n, y / n, z / n];
}

const EYE_BALLS = [
  { centre: centroid([33, 133, 159, 145]), radius: 1.15 },
  { centre: centroid([263, 362, 386, 374]), radius: 1.15 },
];
const LIP_PAD = { centre: centroid([61, 291, 0, 17]), radius: 1.05 };

/* -------------------------------------------------------------------------- */
/* Renderer                                                                    */
/* -------------------------------------------------------------------------- */

function render({ yaw, width = 900, height = 1200 }) {
  const rgba = Buffer.alloc(width * height * 4);

  const cy = Math.cos((yaw * Math.PI) / 180);
  const sy = Math.sin((yaw * Math.PI) / 180);
  // Screen axes: right = (cos yaw, 0, -sin yaw), up = +Y, towards = (sin yaw, 0, cos yaw).
  const right = [cy, 0, -sy];
  const up = [0, 1, 0];
  const towards = [sy, 0, cy];

  const projectPoint = (x, y, z) => {
    const sx = right[0] * x + right[1] * y + right[2] * z;
    const syy = up[0] * x + up[1] * y + up[2] * z;
    const depth = towards[0] * x + towards[1] * y + towards[2] * z;
    return [sx, syy, depth];
  };

  // -- bounds (mesh + head solids) so the framing is stable -----------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < vertexCount; v += 1) {
    const [sx, syy] = projectPoint(
      positions[v * 3],
      positions[v * 3 + 1],
      positions[v * 3 + 2],
    );
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (syy < minY) minY = syy;
    if (syy > maxY) maxY = syy;
  }
  for (const solid of [CRANIUM, HAIR_CAP]) {
    const [sx, syy] = projectPoint(...solid.centre);
    if (sx - solid.radius < minX) minX = sx - solid.radius;
    if (sx + solid.radius > maxX) maxX = sx + solid.radius;
    if (syy - solid.radius < minY) minY = syy - solid.radius;
    if (syy + solid.radius > maxY) maxY = syy + solid.radius;
  }

  const margin = 0.07;
  const span = Math.max(maxX - minX, maxY - minY);
  const scale = (Math.min(width, height) * (1 - margin * 2)) / span;
  const originX = (minX + maxX) / 2;
  const originY = (minY + maxY) / 2;

  const toScreen = (sx, syy) => [
    width / 2 + (sx - originX) * scale,
    height / 2 - (syy - originY) * scale,
  ];
  const project = (x, y, z) => {
    const [sx, syy] = projectPoint(x, y, z);
    return toScreen(sx, syy);
  };

  // -- background: soft studio gradient with a vignette ----------------------
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const t = y / height;
      const vignette =
        1 -
        0.45 *
          Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2)) ** 2;
      rgba[o] = Math.round((150 + 70 * t) * vignette);
      rgba[o + 1] = Math.round((156 + 74 * t) * vignette);
      rgba[o + 2] = Math.round((166 + 78 * t) * vignette);
      rgba[o + 3] = 255;
    }
  }

  const light = normalise([
    towards[0] * 0.62 + right[0] * 0.55 + up[0] * 0.55,
    towards[1] * 0.62 + right[1] * 0.55 + up[1] * 0.55,
    towards[2] * 0.62 + right[2] * 0.55 + up[2] * 0.55,
  ]);

  /** Draw a sphere: silhouette circle with Lambert shading. */
  const drawSphere = (solid, colour) => {
    const [cx, cy2] = project(...solid.centre);
    const r = solid.radius * scale;
    const minPx = Math.max(0, Math.floor(cx - r));
    const maxPx = Math.min(width - 1, Math.ceil(cx + r));
    const minPy = Math.max(0, Math.floor(cy2 - r));
    const maxPy = Math.min(height - 1, Math.ceil(cy2 + r));
    for (let y = minPy; y <= maxPy; y += 1) {
      for (let x = minPx; x <= maxPx; x += 1) {
        const a = (x + 0.5 - cx) / r;
        const b = -(y + 0.5 - cy2) / r;
        const q = a * a + b * b;
        if (q > 1) continue;
        const c = Math.sqrt(Math.max(0, 1 - q));
        const nx = right[0] * a + up[0] * b + towards[0] * c;
        const ny = right[1] * a + up[1] * b + towards[1] * c;
        const nz = right[2] * a + up[2] * b + towards[2] * c;
        const lambert = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
        const shade = 0.34 + 0.66 * lambert;
        blend(rgba, (y * width + x) * 4, [
          Math.round(colour[0] * shade),
          Math.round(colour[1] * shade),
          Math.round(colour[2] * shade),
        ], 1);
      }
    }
  };

  // -- shoulders and neck (behind the head) ---------------------------------
  const shoulder = [
    project(-11, -21, -3),
    project(11, -21, -3),
    project(9.5, -14.5, -2),
    project(-9.5, -14.5, -2),
  ];
  drawPolygon(rgba, width, height, shoulder, CLOTH, 1);

  const neck = [
    project(-2.9, -9.5, -3.2),
    project(2.9, -9.5, -3.2),
    project(3.4, -16, -3.2),
    project(-3.4, -16, -3.2),
  ];
  drawPolygon(rgba, width, height, neck, [
    Math.round(SKIN[0] * 0.82),
    Math.round(SKIN[1] * 0.82),
    Math.round(SKIN[2] * 0.82),
  ], 1);

  // -- hair, then cranium (skin in front of the hair) -----------------------
  drawSphere(HAIR_CAP, HAIR);
  drawSphere(CRANIUM, SKIN);

  // -- ears ------------------------------------------------------------------
  const profileish = Math.abs(yaw) > 55;
  for (const ear of EARS) {
    if (profileish) {
      // Only the ear on the observed side is visible.
      const side = Math.sign(yaw);
      if (Math.sign(ear.centre[0]) !== side) continue;
    }
    const [cx, cy2] = project(...ear.centre);
    drawDisc(
      rgba,
      width,
      height,
      cx,
      cy2,
      ear.radius[0] * scale,
      ear.radius[1] * scale,
      [Math.round(SKIN[0] * 0.9), Math.round(SKIN[1] * 0.9), Math.round(SKIN[2] * 0.9)],
      1,
    );
  }

  // -- face surface ----------------------------------------------------------
  const order = [];
  for (let t = 0; t < triangles; t += 1) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const depth =
      (projectPoint(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2])[2] +
        projectPoint(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2])[2] +
        projectPoint(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2])[2]) /
      3;
    order.push({ a, b, c, depth });
  }
  order.sort((p, q) => p.depth - q.depth);

  for (const tri of order) {
    const { a, b, c } = tri;
    const e1 = [
      positions[b * 3] - positions[a * 3],
      positions[b * 3 + 1] - positions[a * 3 + 1],
      positions[b * 3 + 2] - positions[a * 3 + 2],
    ];
    const e2 = [
      positions[c * 3] - positions[a * 3],
      positions[c * 3 + 1] - positions[a * 3 + 1],
      positions[c * 3 + 2] - positions[a * 3 + 2],
    ];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const lambert = Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);
    const shade = 0.4 + 0.6 * lambert;

    const [ax, ay] = project(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
    const [bx, by] = project(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
    const [cx2, cy3] = project(positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]);
    fillTriangle(rgba, width, height, ax, ay, bx, by, cx2, cy3, [
      Math.round(SKIN[0] * shade),
      Math.round(SKIN[1] * shade),
      Math.round(SKIN[2] * shade),
    ]);
  }

  drawFeatures(rgba, width, height, project, scale, (solid, colour) => drawSphere(solid, colour));

  return { rgba, width, height };
}

function drawFeatures(rgba, width, height, project, scale, drawSphere) {
  const p = (index) => project(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);

  // Eye balls and lips are solids: they keep their volume in a profile view.
  for (const ball of EYE_BALLS) {
    drawSphere(ball, [238, 235, 228]);
  }
  drawSphere(LIP_PAD, [176, 106, 104]);

  drawPolyline(rgba, width, height, FEATURES.rightBrow.map(p), 0.016 * scale, [92, 70, 54]);
  drawPolyline(rgba, width, height, FEATURES.leftBrow.map(p), 0.016 * scale, [92, 70, 54]);

  const lips = [...FEATURES.upperLip, ...FEATURES.lowerLip.slice(1, -1)].map(p);
  drawPolygon(rgba, width, height, lips, [178, 108, 106], 0.9);
  const mouthLine = FEATURES.mouthLine.map(p);
  drawPolyline(rgba, width, height, [...mouthLine, mouthLine[0]], 0.010 * scale, [110, 60, 64]);

  // The iris sits on the front of the eye ball so it stays visible in profile.
  for (const ball of EYE_BALLS) {
    const [cx, cy] = project(ball.centre[0], ball.centre[1], ball.centre[2] + ball.radius * 0.55);
    const r = ball.radius * scale;
    drawDisc(rgba, width, height, cx, cy, r * 0.52, r * 0.52, [62, 45, 36], 1);
    drawDisc(rgba, width, height, cx, cy, r * 0.22, r * 0.22, [16, 12, 10], 1);
  }

  for (const index of FEATURES.nostril) {
    const [x, y] = p(index);
    drawDisc(rgba, width, height, x, y + 0.01 * scale, 0.02 * scale, 0.011 * scale, [96, 62, 50], 0.85);
  }
}

function normalise(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const views = [
  { name: "front.png", yaw: 0 },
  { name: "left-profile.png", yaw: 90 },
  { name: "right-profile.png", yaw: -90 },
  { name: "left-three-quarter.png", yaw: 45 },
  { name: "right-three-quarter.png", yaw: -45 },
];

if (process.argv.includes("--sweep")) {
  for (const yaw of [50, 60, 70, 80, 85, 90, 95, 100, 110, 120]) {
    views.push({ name: `sweep-${yaw}.png`, yaw });
  }
}

for (const view of views) {
  const { rgba, width, height } = render(view);
  const path = join(OUT_DIR, view.name);
  writePng(path, width, height, rgba);
  console.log(`wrote ${path}`);

  if (process.argv.includes("--ascii")) {
    const cols = 46;
    const rows = 30;
    const chars = " .:-=+*#%@";
    let art = "";
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x0 = Math.floor((c * width) / cols);
        const x1 = Math.floor(((c + 1) * width) / cols);
        const y0 = Math.floor((r * height) / rows);
        const y1 = Math.floor(((r + 1) * height) / rows);
        let sum = 0;
        let count = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const o = (y * width + x) * 4;
            sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
            count += 1;
          }
        }
        const lum = count ? sum / count / 255 : 0;
        art += chars[Math.min(chars.length - 1, Math.floor(lum * chars.length))];
      }
      art += "\n";
    }
    console.log(art);
  }
}
