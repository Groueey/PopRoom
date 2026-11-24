import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = process.cwd();
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

// Standard IEEE 802.3 CRC32 table for PNG chunks.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // standard filter
  ihdr[12] = 0; // non-interlaced

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowOut = y * stride;
    raw[rowOut] = 0; // filter type None
    rgba.copy(raw, rowOut + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Signed distance to an axis-aligned rounded box centered at (cx, cy). */
function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - radius;
}

/** Signed distance to a circle centered at (cx, cy). */
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Alpha-over compositing of source [r, g, b, a] onto destination rgba buffer at index idx. */
function blendPixel(buf, idx, sr, sg, sb, sa) {
  if (sa <= 0) {
    return;
  }
  const srcA = clamp01(sa);
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) {
    return;
  }
  const dr = buf[idx];
  const dg = buf[idx + 1];
  const db = buf[idx + 2];
  buf[idx] = Math.round((sr * srcA + dr * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((sg * srcA + dg * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((sb * srcA + db * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

/**
 * Renders the PopRoom Palette A geometric brand mark into an RGBA buffer.
 * - `mode: 'icon'` renders an opaque terracotta gradient canvas with the warm-white room card + 4 block tiles.
 * - `mode: 'adaptive'` renders a transparent canvas with the warm-white room card + 4 block tiles sized inside Android's 58% safe zone.
 * - `mode: 'splash'` renders a transparent canvas with a centered terracotta squircle emblem containing the warm-white 4-block mark.
 */
function renderPopRoomAsset(size, mode) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.4 / size;

  const isIcon = mode === 'icon';
  const isAdaptive = mode === 'adaptive';
  const isSplash = mode === 'splash';

  // Emblem scale in normalized [-0.5, 0.5] coordinates.
  const cardHalf = isAdaptive ? 0.235 : isSplash ? 0.275 : 0.305;
  const cardRadius = cardHalf * 0.42;

  // Inner 2x2 collaborative block grid geometry inside the emblem card.
  const innerSpan = cardHalf * 0.66;
  const tileGap = cardHalf * 0.095;
  const tileHalf = (innerSpan - tileGap) / 2;
  const tileOffset = tileHalf + tileGap;
  const tileRadius = tileHalf * 0.38;

  // 4-module Palette A accents (poll terracotta, task sage, schedule sky, expense amber)
  const tileColors = [
    { cx: -tileOffset, cy: -tileOffset, rgb: [224, 90, 43] }, // top-left: Poll (#E05A2B)
    { cx: tileOffset, cy: -tileOffset, rgb: [42, 133, 101] }, // top-right: Task (#2A8565)
    { cx: -tileOffset, cy: tileOffset, rgb: [59, 111, 212] }, // bottom-left: Schedule (#3B6FD4)
    { cx: tileOffset, cy: tileOffset, rgb: [196, 125, 22] }, // bottom-right: Expense (#C47D16)
  ];

  // Splash uses crisp warm-white tiles on a terracotta squircle emblem.
  const splashTileRgb = [253, 241, 236]; // #FDF1EC
  const splashAccentRgb = [255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    const ny = (y + 0.5) / size - 0.5;
    const gradT = clamp01((ny + 0.5));

    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size - 0.5;
      const idx = (y * size + x) * 4;

      if (isIcon) {
        // Full-bleed warm terracotta gradient (#E56536 -> #C4481D) with subtle top-left radial glow.
        const glow = Math.max(0, 1 - Math.hypot(nx + 0.22, ny + 0.26) * 1.35);
        const r = Math.min(255, Math.round(229 + (196 - 229) * gradT + glow * 16));
        const g = Math.min(255, Math.round(101 + (72 - 101) * gradT + glow * 14));
        const b = Math.min(255, Math.round(54 + (29 - 54) * gradT + glow * 8));
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      }

      if (isSplash) {
        // Soft drop shadow beneath the terracotta squircle on #F6F5F2 splash canvas.
        const shadowDist = sdRoundedBox(nx, ny - 0.014, 0, 0, cardHalf, cardHalf, cardRadius);
        const shadowAlpha = (1 - smoothstep(-0.004, 0.032, shadowDist)) * 0.14;
        blendPixel(rgba, idx, 61, 52, 44, shadowAlpha);

        // Terracotta rounded emblem body.
        const badgeDist = sdRoundedBox(nx, ny, 0, 0, cardHalf, cardHalf, cardRadius);
        const badgeAlpha = 1 - smoothstep(-aa, aa, badgeDist);
        if (badgeAlpha > 0) {
          const localT = clamp01((ny + cardHalf) / (2 * cardHalf));
          const br = Math.round(229 + (196 - 229) * localT);
          const bg = Math.round(101 + (72 - 101) * localT);
          const bb = Math.round(54 + (29 - 54) * localT);
          blendPixel(rgba, idx, br, bg, bb, badgeAlpha);
        }

        // Inner warm-white 4 collaborative room blocks.
        for (let i = 0; i < tileColors.length; i += 1) {
          const tile = tileColors[i];
          const d = sdRoundedBox(nx, ny, tile.cx, tile.cy, tileHalf, tileHalf, tileRadius);
          const a = 1 - smoothstep(-aa, aa, d);
          if (a > 0) {
            const rgb = i === 0 || i === 3 ? splashAccentRgb : splashTileRgb;
            blendPixel(rgba, idx, rgb[0], rgb[1], rgb[2], a * (i === 0 || i === 3 ? 0.98 : 0.86));
          }
        }

        // Small tangerine leaf highlight dot near top-right corner of the badge.
        const leafDist = sdCircle(
          nx,
          ny,
          cardHalf * 0.62,
          -cardHalf * 0.62,
          cardHalf * 0.095,
        );
        const leafAlpha = 1 - smoothstep(-aa, aa, leafDist);
        if (leafAlpha > 0) {
          blendPixel(rgba, idx, 255, 255, 255, leafAlpha * 0.25);
        }
      } else {
        // Icon & Adaptive foreground: subtle shadow + crisp warm-white rounded room card.
        if (isIcon) {
          const shadowDist = sdRoundedBox(nx, ny - 0.016, 0, 0, cardHalf, cardHalf, cardRadius);
          const shadowAlpha = (1 - smoothstep(-0.005, 0.036, shadowDist)) * 0.18;
          blendPixel(rgba, idx, 90, 28, 10, shadowAlpha);
        }

        const cardDist = sdRoundedBox(nx, ny, 0, 0, cardHalf, cardHalf, cardRadius);
        const cardAlpha = 1 - smoothstep(-aa, aa, cardDist);
        if (cardAlpha > 0) {
          // Warm porcelain-white card (#FFFDFB)
          blendPixel(rgba, idx, 255, 253, 251, cardAlpha);
        }

        // 4 Palette A collaborative tiles inside the card.
        for (let i = 0; i < tileColors.length; i += 1) {
          const tile = tileColors[i];
          const d = sdRoundedBox(nx, ny, tile.cx, tile.cy, tileHalf, tileHalf, tileRadius);
          const a = 1 - smoothstep(-aa, aa, d);
          if (a > 0) {
            blendPixel(rgba, idx, tile.rgb[0], tile.rgb[1], tile.rgb[2], a);
          }
        }

        // Subtle warm dot accent inside the terracotta top-left tile (evoking a PopRoom pin).
        const dotDist = sdCircle(
          nx,
          ny,
          -tileOffset,
          -tileOffset,
          tileHalf * 0.28,
        );
        const dotAlpha = 1 - smoothstep(-aa, aa, dotDist);
        if (dotAlpha > 0) {
          blendPixel(rgba, idx, 255, 250, 246, dotAlpha * 0.92);
        }
      }
    }
  }

  return encodeRgbaPng(size, size, rgba);
}

function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const outputs = [
    { file: 'icon.png', size: 1024, mode: 'icon' },
    { file: 'adaptive-icon.png', size: 1024, mode: 'adaptive' },
    { file: 'splash-icon.png', size: 1024, mode: 'splash' },
    { file: 'favicon.png', size: 48, mode: 'splash' },
  ];

  for (const item of outputs) {
    const png = renderPopRoomAsset(item.size, item.mode);
    const outPath = path.join(ASSETS_DIR, item.file);
    fs.writeFileSync(outPath, png);
    console.log(`[PopRoom] Generated ${item.file} (${item.size}x${item.size}, ${png.length} bytes)`);
  }
}

main();
