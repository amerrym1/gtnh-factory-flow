import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

/**
 * Trim a structure render to its opaque bounds and fit it back into the
 * 640x640 canvas, so a shader render's lots-of-empty-space framing looks like
 * the hand-shot 2.9 renders. Nearest-neighbour keeps the pixel art crisp.
 *
 * Usage: crop-structure-art.mjs <directory-of-640px-pngs>
 */
const dir = process.argv[2];
if (!dir) {
  throw new Error("Usage: crop-structure-art.mjs <directory>");
}
const PADDING = 0.04;

for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".png"))) {
  const filePath = path.join(dir, file);
  const image = PNG.sync.read(fs.readFileSync(filePath));
  const bounds = opaqueBounds(image);
  if (!bounds) {
    console.log(`Skipping ${file}: no opaque pixels.`);
    continue;
  }
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const side = Math.max(width, height) * (1 + PADDING * 2);
  const centerX = (bounds.minX + bounds.maxX + 1) / 2;
  const centerY = (bounds.minY + bounds.maxY + 1) / 2;
  const left = centerX - side / 2;
  const top = centerY - side / 2;
  const out = new PNG({ width: 640, height: 640 });
  for (let y = 0; y < 640; y++) {
    for (let x = 0; x < 640; x++) {
      const sx = Math.floor(left + (x / 640) * side);
      const sy = Math.floor(top + (y / 640) * side);
      const target = (y * 640 + x) * 4;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) {
        out.data[target + 3] = 0;
        continue;
      }
      const source = (sy * image.width + sx) * 4;
      out.data[target] = image.data[source];
      out.data[target + 1] = image.data[source + 1];
      out.data[target + 2] = image.data[source + 2];
      out.data[target + 3] = image.data[source + 3];
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(out));
  console.log(`${file}: ${width}x${height} -> 640x640`);
}

function opaqueBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? undefined : { minX, minY, maxX, maxY };
}
