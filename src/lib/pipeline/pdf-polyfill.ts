/**
 * Minimal polyfills for pdfjs-dist in Node.js/serverless environments.
 * pdfjs-dist v5 expects DOMMatrix, Path2D, and ImageData for rendering,
 * but we only use it for text extraction. These stubs prevent import crashes.
 *
 * Also pre-loads the pdfjs worker to avoid dynamic import() failures on
 * Vercel with pnpm (symlinked node_modules break relative imports).
 */

// Pre-load the pdfjs worker into globalThis.pdfjsWorker so pdfjs-dist
// skips its broken relative dynamic import("./pdf.worker.mjs") on Vercel
// with pnpm. We resolve the path via pdf-parse (direct dep) → pdfjs-dist
// (its dependency) to handle pnpm's symlinked node_modules.
import { join } from "path";

function resolveWorkerPath(): string {
  try {
    // pdf-parse is a direct dep; pdfjs-dist is its peer in pnpm's
    // virtual store. Find the node_modules directory containing pdf-parse,
    // then reference pdfjs-dist as a sibling package.
    const pdfParsePath = require.resolve("pdf-parse");
    const marker = "/node_modules/pdf-parse/";
    const idx = pdfParsePath.indexOf(marker);
    if (idx === -1) return "pdfjs-dist/legacy/build/pdf.worker.mjs";
    const nodeModulesDir = pdfParsePath.substring(0, idx + "/node_modules/".length);
    return join(nodeModulesDir, "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  } catch {
    return "pdfjs-dist/legacy/build/pdf.worker.mjs";
  }
}

export const workerReady = import(/* webpackIgnore: true */ resolveWorkerPath())
  .then((mod) => { (globalThis as Record<string, unknown>).pdfjsWorker = mod; })
  .catch(() => { /* worker pre-load failed — text extraction will fall back to visual */ });

if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error — minimal stub, not a full implementation
  globalThis.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    inverse() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    rotate() { return new DOMMatrix(); }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
    toFloat32Array() { return new Float32Array(16); }
    toFloat64Array() { return new Float64Array(16); }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  // @ts-expect-error — minimal stub
  globalThis.Path2D = class Path2D {
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
  };
}

if (typeof globalThis.ImageData === "undefined") {
  // @ts-expect-error — minimal stub
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}
