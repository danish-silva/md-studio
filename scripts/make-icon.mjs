/**
 * Draws the source icon that `tauri icon` expands into every platform size.
 *
 * Written by hand rather than pulled from a rasteriser so the repository carries no
 * native image dependency for something run once in a while. The output is deterministic:
 * running this again produces byte-identical bytes.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SIZE = 1024;
const SAMPLES = 3; // 3x3 supersampling, which is plenty at this size.

const BACKGROUND = [0x6f, 0x5d, 0xe8, 0xff];
const MARK = [0xff, 0xff, 0xff, 0xff];

/** The markdown mark: an M and a downward arrow, the convention for the format. */
function markCoverage(x, y) {
  const bar = 62;

  // M: two uprights and the valley between them.
  if (inRect(x, y, 214, 372, 214 + bar, 652)) return true;
  if (inRect(x, y, 428, 372, 428 + bar, 652)) return true;
  if (nearSegment(x, y, 245, 372, 352, 548, bar)) return true;
  if (nearSegment(x, y, 459, 372, 352, 548, bar)) return true;

  // Arrow: a stem and a head.
  if (inRect(x, y, 630, 372, 630 + bar, 548)) return true;
  if (inTriangle(x, y, 566, 524, 756, 524, 661, 660)) return true;

  return false;
}

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function nearSegment(x, y, x0, y0, x1, y1, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length));
  const px = x0 + t * dx - x;
  const py = y0 + t * dy - y;
  return Math.hypot(px, py) <= width / 2;
}

function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** Squircle-ish corners, so the icon sits comfortably next to platform ones. */
function inRoundedSquare(x, y, radius) {
  const inset = 0;
  const x0 = inset;
  const y0 = inset;
  const x1 = SIZE - inset;
  const y1 = SIZE - inset;

  if (x < x0 || x > x1 || y < y0 || y > y1) return false;

  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const step = 1 / SAMPLES;
  const total = SAMPLES * SAMPLES;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let background = 0;
      let mark = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;
          if (!inRoundedSquare(px, py, 224)) continue;
          background += 1;
          if (markCoverage(px, py)) mark += 1;
        }
      }

      const at = (y * SIZE + x) * 4;
      if (background === 0) continue;

      // Composite the mark over the background, then the whole thing over transparency.
      const markRatio = mark / background;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[at + channel] = Math.round(
          BACKGROUND[channel] * (1 - markRatio) + MARK[channel] * markRatio,
        );
      }
      pixels[at + 3] = Math.round((background / total) * 255);
    }
  }

  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // Each scanline is prefixed with its filter type; 0 means none.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'icon-source.png');
writeFileSync(target, encodePng(SIZE, SIZE, render()));
console.log(`wrote ${target}`);
